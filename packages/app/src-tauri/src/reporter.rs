//! Reporter host layer (007-reporter-protocol.md §2.2).
//!
//! Jot Deck spawns each configured Reporter as a child process and **owns the
//! stdio pipe** (the inverse of the MCP bridge, which Claude spawns). This module
//! is the thin Tauri half: it spawns children, pumps the bidirectional stdio, and
//! turns committed writes into a frontend change event. The transport-agnostic
//! core — JSON-RPC dispatch onto `jot_deck_core::access` and the per-Reporter
//! scope — lives in the `jot-deck-reporter-host` crate.
//!
//! Lifecycle is subordinate to the parent (007 §2.2): children spawn with
//! `kill_on_drop`, and a stop aborts the pump task, which drops the child and
//! kills the process.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use jot_deck_core::repository::setting;
use jot_deck_core::Connection;
use jot_deck_reporter_host::{
    handle_message, peek_ephemeral, Capabilities, Committed, ReporterScope,
};
use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;

use crate::{get_conn, AppState, CommandError, CommandResult};

/// Tauri event emitted after a Reporter commits a write, so the frontend reloads
/// the affected column (or the column set for a structural change). Distinct
/// from `external-db-change`: those come from *other* processes via the
/// `data_version` poller, but a Reporter shares the GUI's own connection, so its
/// writes never bump `data_version` and must be signalled explicitly.
const REPORTER_CHANGE_EVENT: &str = "reporter-change";

/// Tauri event carrying the ephemeral stream lifecycle (007 §6.2): `begin` /
/// `delta` / `end`. Distinct from `reporter-change` (committed reloads): deltas
/// are high-frequency, never hit the DB, and must not trigger a column reload —
/// the frontend applies them to an in-memory overlay (007 §4 / §8).
const REPORTER_STREAM_EVENT: &str = "reporter-stream";

/// Tauri event emitted when a running Reporter's child process ends on its own
/// (self-termination, crash, or pipe close) — as opposed to an explicit
/// `stop_reporter`. The registration UI listens for this to drop the Reporter's
/// "Running" badge without polling.
const REPORTER_EXIT_EVENT: &str = "reporter-exit";

/// Persisted registration for one Reporter, stored in a JSON array under the
/// settings key `reporters`. `command` is the absolute binary path the
/// power-user registers (007 §2.2); `deck_ids` / `deny` / `max_writes_per_min` /
/// `allowed_columns` carry the per-Reporter auth scope (007 §2.3) — the same
/// limits `JOT_DECK_DECK_ID` / `JOT_DECK_DENY` / `JOT_DECK_MAX_WRITES_PER_MIN` /
/// `JOT_DECK_WRITE_COLUMNS` put on an MCP connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReporterConfig {
    /// Stable id (ULID) assigned on add; also the occupancy-lock holder in Phase 2.
    #[serde(default)]
    pub reporter_id: String,
    /// Human-readable label shown in the registration UI.
    pub name: String,
    /// Decks the Reporter may address; `None` = every Deck (then Deck-level
    /// calls must name a `deck_id`). One Deck lets calls omit it.
    #[serde(default)]
    pub deck_ids: Option<Vec<String>>,
    /// Absolute path to the Reporter binary.
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// Capabilities to disable (`append`/`edit`/`delete`/`structure`).
    #[serde(default)]
    pub deny: Vec<String>,
    /// Per-Reporter write rate cap; `None` uses the host default.
    #[serde(default)]
    pub max_writes_per_min: Option<usize>,
    /// Optional write allowlist by column ULID (any of its Decks); `None` =
    /// every visible column.
    #[serde(default)]
    pub allowed_columns: Option<Vec<String>>,
}

impl ReporterConfig {
    /// Build the runtime auth scope this registration authorizes. Fail-closed:
    /// a scope that can't be honored exactly (unknown capability, zero rate,
    /// empty Deck list, empty allowlist) is an error rather than a silently
    /// wider grant.
    fn to_scope(&self) -> CommandResult<ReporterScope> {
        let (capabilities, unknown) =
            Capabilities::from_deny(self.deny.iter().map(String::as_str));
        if !unknown.is_empty() {
            return Err(CommandError {
                message: format!(
                    "Unknown capability in deny list: {} (expected append/edit/delete/structure)",
                    unknown.join(", ")
                ),
            });
        }
        if self
            .deck_ids
            .as_ref()
            .is_some_and(|ids| ids.iter().all(|id| id.trim().is_empty()))
        {
            return Err(CommandError {
                message: "Deck list must name at least one Deck.".to_string(),
            });
        }
        if self.max_writes_per_min == Some(0) {
            return Err(CommandError {
                message: "Max writes per minute must be at least 1.".to_string(),
            });
        }
        if self.allowed_columns.as_ref().is_some_and(|cols| cols.is_empty()) {
            return Err(CommandError {
                message: "Column allowlist must name at least one column.".to_string(),
            });
        }
        let max = self
            .max_writes_per_min
            .unwrap_or(jot_deck_reporter_host::DEFAULT_MAX_WRITES_PER_MIN);
        Ok(ReporterScope::new(
            self.deck_ids.clone(),
            capabilities,
            max,
            self.allowed_columns.clone(),
            self.reporter_id.clone(),
        ))
    }
}

/// A running Reporter: the pump task's abort handle, plus the id of *this* run.
/// Aborting the pump drops the owned child, and `kill_on_drop` kills the OS
/// process — so the registry needs nothing more to enforce the parent-subordinate
/// lifecycle. The `run_id` distinguishes successive runs of the same Reporter, so
/// an exiting pump can only ever clear its own entry (see `start_reporter`).
struct RunningReporter {
    pump: JoinHandle<()>,
    run_id: u64,
}

/// Managed state: which Reporters are currently running, keyed by `reporter_id`.
#[derive(Default)]
pub struct ReporterRegistry {
    running: Mutex<HashMap<String, RunningReporter>>,
    /// Monotonic source of `RunningReporter::run_id`, unique per spawn attempt.
    next_run_id: AtomicU64,
}

/// The settings key holding every Reporter registration.
const REPORTERS_KEY: &str = "reporters";

/// Prefix of the per-Deck keys (`reporters:{deck_id}`) registrations were kept
/// under before they spanned Decks; `load_configs` folds them into
/// `REPORTERS_KEY`.
const LEGACY_KEY_PREFIX: &str = "reporters:";

fn parse_configs(key: &str, json: &str) -> CommandResult<Vec<ReporterConfig>> {
    serde_json::from_str(json).map_err(|e| CommandError {
        message: format!("Corrupt reporter config under '{}': {}", key, e),
    })
}

/// Load every Reporter registration (empty when unset). Registrations still
/// under a per-Deck key are moved into the global list first, limited to that
/// Deck so a Reporter never reaches more than it did before.
fn load_configs(conn: &Connection) -> CommandResult<Vec<ReporterConfig>> {
    let mut configs = match setting::get(conn, REPORTERS_KEY).map_err(CommandError::from)? {
        None => Vec::new(),
        Some(json) => parse_configs(REPORTERS_KEY, &json)?,
    };
    let legacy = setting::list_by_prefix(conn, LEGACY_KEY_PREFIX).map_err(CommandError::from)?;
    if legacy.is_empty() {
        return Ok(configs);
    }
    for (key, json) in &legacy {
        let deck_id = &key[LEGACY_KEY_PREFIX.len()..];
        for mut config in parse_configs(key, json)? {
            // Ids were only unique within one Deck (and a caller could supply
            // one), so a clash across Decks gets a fresh id instead of being
            // dropped — every registration keeps its Deck.
            if config.reporter_id.is_empty()
                || configs.iter().any(|c| c.reporter_id == config.reporter_id)
            {
                config.reporter_id = ulid::Ulid::generate().to_string();
            }
            config.deck_ids = Some(vec![deck_id.to_string()]);
            configs.push(config);
        }
    }
    let tx = conn.unchecked_transaction().map_err(|e| CommandError {
        message: format!("Failed to migrate reporter config: {}", e),
    })?;
    save_configs(&tx, &configs)?;
    for (key, _) in &legacy {
        setting::delete(&tx, key).map_err(CommandError::from)?;
    }
    tx.commit().map_err(|e| CommandError {
        message: format!("Failed to migrate reporter config: {}", e),
    })?;
    Ok(configs)
}

/// Persist every Reporter registration.
fn save_configs(conn: &Connection, configs: &[ReporterConfig]) -> CommandResult<()> {
    let json = serde_json::to_string(configs).map_err(|e| CommandError {
        message: format!("Failed to serialize reporter config: {}", e),
    })?;
    setting::set(conn, REPORTERS_KEY, &json).map_err(CommandError::from)
}

/// List every registered Reporter.
#[tauri::command]
pub fn list_reporters(state: State<AppState>) -> CommandResult<Vec<ReporterConfig>> {
    load_configs(&*get_conn(&state)?)
}

/// Register a new Reporter; assigns and returns a `reporter_id`.
#[tauri::command]
pub fn add_reporter(
    state: State<AppState>,
    mut config: ReporterConfig,
) -> CommandResult<ReporterConfig> {
    if config.reporter_id.is_empty() {
        config.reporter_id = ulid::Ulid::generate().to_string();
    }
    config.to_scope()?;
    let conn = get_conn(&state)?;
    let mut configs = load_configs(&conn)?;
    configs.push(config.clone());
    save_configs(&conn, &configs)?;
    Ok(config)
}

/// Update an existing Reporter registration in place (matched by `reporter_id`,
/// which is preserved). Edits to `command`/`args`/`env` and the auth scope take
/// effect on the next `start_reporter`; a currently running child is not
/// restarted here.
#[tauri::command]
pub fn update_reporter(
    state: State<AppState>,
    config: ReporterConfig,
) -> CommandResult<ReporterConfig> {
    config.to_scope()?;
    let conn = get_conn(&state)?;
    let mut configs = load_configs(&conn)?;
    let slot = configs
        .iter_mut()
        .find(|c| c.reporter_id == config.reporter_id)
        .ok_or_else(|| CommandError {
            message: format!("No reporter registered with id {}", config.reporter_id),
        })?;
    *slot = config.clone();
    save_configs(&conn, &configs)?;
    Ok(config)
}

/// List the ids of Reporters currently running.
#[tauri::command]
pub fn list_running_reporters(registry: State<ReporterRegistry>) -> CommandResult<Vec<String>> {
    let running = registry.running.lock().unwrap_or_else(|e| e.into_inner());
    Ok(running.keys().cloned().collect())
}

/// Remove a Reporter registration (stopping it first if running).
#[tauri::command]
pub fn remove_reporter(
    app: AppHandle,
    state: State<AppState>,
    registry: State<ReporterRegistry>,
    reporter_id: String,
) -> CommandResult<()> {
    stop_running(&registry, &reporter_id);
    let _ = app; // reserved for future teardown signalling
    let conn = get_conn(&state)?;
    let mut configs = load_configs(&conn)?;
    configs.retain(|c| c.reporter_id != reporter_id);
    save_configs(&conn, &configs)
}

/// Abort a running Reporter's pump task (dropping the child → `kill_on_drop`).
fn stop_running(registry: &State<ReporterRegistry>, reporter_id: &str) {
    let mut running = registry
        .running
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(r) = running.remove(reporter_id) {
        r.pump.abort();
    }
}

/// Stop a running Reporter.
#[tauri::command]
pub fn stop_reporter(registry: State<ReporterRegistry>, reporter_id: String) -> CommandResult<()> {
    stop_running(&registry, &reporter_id);
    Ok(())
}

/// Spawn a registered Reporter and start pumping its stdio.
#[tauri::command]
pub fn start_reporter(
    app: AppHandle,
    state: State<AppState>,
    registry: State<ReporterRegistry>,
    reporter_id: String,
) -> CommandResult<()> {
    {
        // Fast path: a Reporter already running is a no-op success (avoids
        // spawning a child we'd immediately abort). The *authoritative* dedup is
        // the reserve-under-lock below — this check alone would be a TOCTOU.
        let running = registry.running.lock().unwrap_or_else(|e| e.into_inner());
        if running.contains_key(&reporter_id) {
            return Ok(());
        }
    }

    let config = load_configs(&*get_conn(&state)?)?
        .into_iter()
        .find(|c| c.reporter_id == reporter_id)
        .ok_or_else(|| CommandError {
            message: format!("No reporter registered with id {}", reporter_id),
        })?;

    let scope = std::sync::Arc::new(config.to_scope()?);
    let handle = app.clone();
    let reporter_id_task = reporter_id.clone();

    // The child is spawned *inside* the async task (tokio::process needs the
    // runtime context); a oneshot reports spawn success/failure back so the
    // command can surface a bad binary path to the user synchronously.
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    // Gate: the pump does nothing until the reservation below hands it its
    // `run_id`. Without this the child could exit — and run its registry cleanup
    // — before the entry it is supposed to clear even exists, leaving a finished
    // task registered as running forever (and `start_reporter` short-circuiting
    // on it). A dropped sender means we lost the dedup race or the reservation
    // rolled back, so the pump exits without spawning anything.
    let (registered_tx, registered_rx) = tokio::sync::oneshot::channel::<u64>();

    let pump = tauri::async_runtime::spawn(async move {
        let Ok(run_id) = registered_rx.await else {
            return;
        };
        let mut cmd = TokioCommand::new(&config.command);
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Reporter diagnostics flow to the host's stderr for audit.
            .stderr(Stdio::inherit())
            // Parent-subordinate lifecycle: dropping the child kills it (007 §2.2).
            .kill_on_drop(true);

        let mut child = match cmd.spawn() {
            Ok(c) => {
                let _ = tx.send(Ok(()));
                c
            }
            Err(e) => {
                let _ = tx.send(Err(format!("Failed to spawn reporter: {}", e)));
                return;
            }
        };

        let stdout = child.stdout.take().expect("stdout piped");
        let mut stdin = child.stdin.take().expect("stdin piped");
        // Cap one JSON message so a Reporter that never emits a newline cannot
        // grow the host's read buffer without bound. The per-Reporter write rate
        // limit (scope) caps committed writes, not bytes read, so it does not
        // cover this path.
        const MAX_LINE_BYTES: u64 = 1 << 20; // 1 MiB
        let mut reader = BufReader::new(stdout);
        let mut buf = String::new();

        // Read one JSON message per line; dispatch on the shared GUI connection;
        // write the response back to the child's stdin.
        loop {
            buf.clear();
            // Bound each read so one line can't exceed the cap. A fresh `take`
            // per iteration makes the limit per-message, not cumulative.
            let n = match (&mut reader).take(MAX_LINE_BYTES).read_line(&mut buf).await {
                // EOF or read error (incl. invalid UTF-8): the child closed its
                // stdout — stop pumping.
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            // A full-cap read with no terminating newline means the Reporter is
            // emitting an unbounded line; drop the connection rather than buffer it.
            if n as u64 == MAX_LINE_BYTES && !buf.ends_with('\n') {
                eprintln!(
                    "[jot-deck-reporter-host] reporter {} sent a line exceeding {} bytes; dropping it",
                    reporter_id_task, MAX_LINE_BYTES
                );
                break;
            }
            let line = buf.trim();
            if line.is_empty() {
                continue;
            }

            // Ephemeral fast path: a stream delta never touches the DB (007 §8.2),
            // so recognize it here and push it straight to the overlay without
            // taking the connection lock or the blocking pool. High-frequency
            // deltas must not queue behind DB work.
            if let Some(delta) = peek_ephemeral(line) {
                let _ = handle.emit(
                    REPORTER_STREAM_EVENT,
                    serde_json::json!({
                        "kind": "delta",
                        "card_id": delta.card_id,
                        "chunk": delta.chunk,
                    }),
                );
                continue;
            }

            // spawn_blocking needs a 'static owned message (it can't borrow `buf`).
            let line_owned = line.to_string();
            let handle_blocking = handle.clone();
            let scope_blocking = scope.clone();
            // The DB call is synchronous rusqlite behind a std Mutex; run it on a
            // blocking thread so the async worker isn't stalled while it holds the
            // lock. handle_message never awaits, so holding the lock here is safe.
            let handled = tauri::async_runtime::spawn_blocking(move || {
                let state = handle_blocking.state::<AppState>();
                let conn = state.conn.lock().unwrap_or_else(|e| e.into_inner());
                handle_message(&conn, &scope_blocking, &line_owned)
            })
            .await;

            let handled = match handled {
                Ok(h) => h,
                Err(_) => break, // blocking task panicked/cancelled
            };

            if let Some(resp) = handled.response {
                if stdin.write_all(resp.as_bytes()).await.is_err()
                    || stdin.write_all(b"\n").await.is_err()
                    || stdin.flush().await.is_err()
                {
                    break; // child closed stdin
                }
            }

            if let Some(committed) = handled.committed {
                emit_committed(&handle, &reporter_id_task, committed);
            }
        }

        // Child exited or pipe closed: drop our registry entry so the UI can
        // reflect that it's no longer running. (A stop_reporter abort removes the
        // entry itself; this covers self-termination.)
        if let Some(registry) = handle.try_state::<ReporterRegistry>() {
            let mut running = registry.running.lock().unwrap_or_else(|e| e.into_inner());
            // Clear the entry only if it is still *our* run: a stop-and-restart
            // can register a fresh pump under the same id while this one is
            // winding down, and removing that would orphan a live child (the UI
            // would show it stopped and `stop_reporter` would no longer reach it).
            let ours = running
                .get(&reporter_id_task)
                .is_some_and(|r| r.run_id == run_id);
            // Only signal an exit the UI didn't ask for: if the entry is already
            // gone, a stop_reporter aborted us and the UI knows.
            if ours {
                running.remove(&reporter_id_task);
                let _ = handle.emit(
                    REPORTER_EXIT_EVENT,
                    serde_json::json!({ "reporter_id": reporter_id_task }),
                );
            }
        }
    });

    // Reserve the id under one lock acquisition, holding the pump's abort handle.
    // If a concurrent start_reporter won the race (or it started running between
    // the fast-path check and here), abort our duplicate pump so its child is
    // killed by kill_on_drop, and report idempotent success. This closes the
    // check/insert TOCTOU: two pumps must never exist for one id — the loser's
    // JoinHandle would otherwise be dropped, and dropping a Tokio handle does NOT
    // abort the task, leaving an unreachable pump that keeps its child alive.
    let run_id = {
        let mut running = registry.running.lock().unwrap_or_else(|e| e.into_inner());
        if running.contains_key(&reporter_id) {
            pump.abort();
            return Ok(());
        }
        let run_id = registry.next_run_id.fetch_add(1, Ordering::Relaxed);
        running.insert(reporter_id.clone(), RunningReporter { pump, run_id });
        run_id
    };
    // Reservation is visible; release the gate so the pump may spawn its child.
    // From here the pump's cleanup can only ever remove this run's entry.
    let _ = registered_tx.send(run_id);

    // Wait for the spawn attempt. On failure the child never started (the task
    // returns before its own registry cleanup runs), so roll back the reservation.
    match tauri::async_runtime::block_on(rx) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(msg)) => {
            stop_running(&registry, &reporter_id);
            Err(CommandError { message: msg })
        }
        Err(_) => {
            stop_running(&registry, &reporter_id);
            Err(CommandError {
                message: "Reporter task ended before reporting spawn status".to_string(),
            })
        }
    }
}

/// Emit the frontend event describing what a committed call touched. Card /
/// structure writes go on `reporter-change` (a debounced column reload); stream
/// begin/end go on `reporter-stream` alongside deltas so the overlay lifecycle
/// stays on one channel.
fn emit_committed(app: &AppHandle, reporter_id: &str, committed: Committed) {
    match committed {
        Committed::Card { column_id } => {
            let _ = app.emit(
                REPORTER_CHANGE_EVENT,
                serde_json::json!({ "reporter_id": reporter_id, "column_id": column_id }),
            );
        }
        Committed::Structure => {
            let _ = app.emit(
                REPORTER_CHANGE_EVENT,
                serde_json::json!({ "reporter_id": reporter_id, "column_id": null }),
            );
        }
        Committed::StreamBegin { card_id, column_id } => {
            let _ = app.emit(
                REPORTER_STREAM_EVENT,
                serde_json::json!({
                    "kind": "begin", "card_id": card_id, "column_id": column_id,
                }),
            );
        }
        Committed::StreamEnd { card_id, column_id } => {
            let _ = app.emit(
                REPORTER_STREAM_EVENT,
                serde_json::json!({
                    "kind": "end", "card_id": card_id, "column_id": column_id,
                }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ReporterConfig {
        ReporterConfig {
            reporter_id: "r1".to_string(),
            name: "Minutes".to_string(),
            deck_ids: None,
            command: "/opt/whisper".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            deny: Vec::new(),
            max_writes_per_min: None,
            allowed_columns: None,
        }
    }

    #[test]
    fn to_scope_applies_registered_scope() {
        let scope = ReporterConfig {
            deny: vec!["delete".to_string()],
            max_writes_per_min: Some(30),
            allowed_columns: Some(vec!["col-1".to_string()]),
            ..config()
        }
        .to_scope()
        .expect("valid scope");
        assert!(!scope.capabilities().delete);
        assert!(scope.capabilities().append);
        assert_eq!(scope.max_writes_per_min(), 30);
    }

    #[test]
    fn to_scope_defaults_rate_when_unset() {
        let scope = config().to_scope().expect("default scope");
        assert_eq!(
            scope.max_writes_per_min(),
            jot_deck_reporter_host::DEFAULT_MAX_WRITES_PER_MIN
        );
    }

    #[test]
    fn to_scope_rejects_scopes_it_cannot_honor() {
        let unknown = ReporterConfig {
            deny: vec!["delte".to_string()],
            ..config()
        };
        assert!(unknown.to_scope().is_err());
        let zero_rate = ReporterConfig {
            max_writes_per_min: Some(0),
            ..config()
        };
        assert!(zero_rate.to_scope().is_err());
        let empty_allowlist = ReporterConfig {
            allowed_columns: Some(Vec::new()),
            ..config()
        };
        assert!(empty_allowlist.to_scope().is_err());
        let no_decks = ReporterConfig {
            deck_ids: Some(vec![" ".to_string()]),
            ..config()
        };
        assert!(no_decks.to_scope().is_err());
    }

    #[test]
    fn load_configs_moves_per_deck_registrations_into_the_global_list() {
        let conn = jot_deck_core::create_in_memory().unwrap();
        let mut global = config();
        global.reporter_id = "g".to_string();
        save_configs(&conn, &[global]).unwrap();
        // Older per-Deck entries carry no `deck_ids` field.
        setting::set(
            &conn,
            "reporters:deck-a",
            r#"[{"reporter_id":"a","name":"A","command":"/bin/a"}]"#,
        )
        .unwrap();
        setting::set(
            &conn,
            "reporters:deck-b",
            r#"[{"reporter_id":"b","name":"B","command":"/bin/b","allowed_columns":["c1"]}]"#,
        )
        .unwrap();

        let loaded = load_configs(&conn).unwrap();
        let decks: Vec<(&str, Option<Vec<String>>)> = loaded
            .iter()
            .map(|c| (c.reporter_id.as_str(), c.deck_ids.clone()))
            .collect();
        assert_eq!(
            decks,
            vec![
                ("g", None),
                ("a", Some(vec!["deck-a".to_string()])),
                ("b", Some(vec!["deck-b".to_string()])),
            ]
        );
        assert_eq!(loaded[2].allowed_columns, Some(vec!["c1".to_string()]));
        // Migrated once: the per-Deck keys are gone and a reload is stable.
        assert!(setting::list_by_prefix(&conn, LEGACY_KEY_PREFIX).unwrap().is_empty());
        assert_eq!(load_configs(&conn).unwrap().len(), 3);
    }

    #[test]
    fn corrupt_legacy_config_is_reported_and_kept() {
        let conn = jot_deck_core::create_in_memory().unwrap();
        setting::set(&conn, "reporters:deck-a", "not json").unwrap();
        let err = load_configs(&conn).unwrap_err();
        assert!(err.message.contains("reporters:deck-a"), "{}", err.message);
        assert!(setting::get(&conn, "reporters:deck-a").unwrap().is_some());
    }

    #[test]
    fn migration_keeps_registrations_whose_ids_clash_across_decks() {
        let conn = jot_deck_core::create_in_memory().unwrap();
        setting::set(
            &conn,
            "reporters:deck-a",
            r#"[{"reporter_id":"same","name":"A","command":"/bin/a"}]"#,
        )
        .unwrap();
        setting::set(
            &conn,
            "reporters:deck-b",
            r#"[{"reporter_id":"same","name":"B","command":"/bin/b"},{"reporter_id":"","name":"C","command":"/bin/c"}]"#,
        )
        .unwrap();

        let loaded = load_configs(&conn).unwrap();
        let by_name = |name: &str| loaded.iter().find(|c| c.name == name).unwrap();
        assert_eq!(loaded.len(), 3);
        // The first keeps its id; the clash and the empty id get fresh ones.
        assert_eq!(by_name("A").reporter_id, "same");
        assert_ne!(by_name("B").reporter_id, "same");
        assert!(!by_name("C").reporter_id.is_empty());
        assert_ne!(by_name("B").reporter_id, by_name("C").reporter_id);
        // Each keeps the Deck it was registered under.
        assert_eq!(by_name("A").deck_ids, Some(vec!["deck-a".to_string()]));
        assert_eq!(by_name("B").deck_ids, Some(vec!["deck-b".to_string()]));
        assert_eq!(by_name("C").deck_ids, Some(vec!["deck-b".to_string()]));
    }
}
