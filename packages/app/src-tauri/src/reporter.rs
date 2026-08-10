//! Reporter host layer (007-reporter-protocol.md §2.2, Phase 1).
//!
//! Jot Deck spawns each configured Reporter as a child process and **owns the
//! stdio pipe** (the inverse of the MCP bridge, which Claude spawns). This module
//! is the thin Tauri half: it spawns children, pumps the bidirectional stdio, and
//! turns committed writes into a frontend change event. The transport-agnostic
//! core — JSON-RPC dispatch onto `jot_deck_core::write`/`query` and the
//! per-Reporter scope — lives in the `jot-deck-reporter-host` crate.
//!
//! Lifecycle is subordinate to the parent (007 §2.2): children spawn with
//! `kill_on_drop`, and a stop aborts the pump task, which drops the child and
//! kills the process. The confirmed channel only (Phase 1); the ephemeral stream
//! (`card.stream.*`) is Phase 2.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use jot_deck_core::repository::setting;
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

/// Persisted registration for one Reporter, stored as a JSON array under the
/// settings key `reporters:{deck_id}`. `command` is the absolute binary path the
/// power-user registers (007 §2.2); `deny`/`max_writes_per_min`/`allowed_columns`
/// carry the per-Reporter auth scope (007 §10).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReporterConfig {
    /// Stable id (ULID) assigned on add; also the occupancy-lock holder in Phase 2.
    #[serde(default)]
    pub reporter_id: String,
    /// Human-readable label shown in the registration UI.
    pub name: String,
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
    /// Optional write allowlist by column ULID; `None` = the whole Deck.
    #[serde(default)]
    pub allowed_columns: Option<Vec<String>>,
}

impl ReporterConfig {
    /// Build the runtime auth scope this registration authorizes.
    fn to_scope(&self) -> ReporterScope {
        let capabilities = Capabilities::from_deny_list(&self.deny.join(","));
        let max = self
            .max_writes_per_min
            .unwrap_or(jot_deck_reporter_host::DEFAULT_MAX_WRITES_PER_MIN);
        ReporterScope::new(
            capabilities,
            max,
            self.allowed_columns.clone(),
            self.reporter_id.clone(),
        )
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

/// The settings key holding a deck's Reporter registrations.
fn config_key(deck_id: &str) -> String {
    format!("reporters:{}", deck_id)
}

/// Load a deck's Reporter registrations (empty when unset).
fn load_configs(state: &State<AppState>, deck_id: &str) -> CommandResult<Vec<ReporterConfig>> {
    let conn = get_conn(state)?;
    let raw = setting::get(&conn, &config_key(deck_id)).map_err(CommandError::from)?;
    match raw {
        None => Ok(Vec::new()),
        Some(json) => serde_json::from_str(&json).map_err(|e| CommandError {
            message: format!("Corrupt reporter config for deck {}: {}", deck_id, e),
        }),
    }
}

/// Persist a deck's Reporter registrations.
fn save_configs(
    state: &State<AppState>,
    deck_id: &str,
    configs: &[ReporterConfig],
) -> CommandResult<()> {
    let json = serde_json::to_string(configs).map_err(|e| CommandError {
        message: format!("Failed to serialize reporter config: {}", e),
    })?;
    let conn = get_conn(state)?;
    setting::set(&conn, &config_key(deck_id), &json).map_err(CommandError::from)
}

/// List a deck's registered Reporters.
#[tauri::command]
pub fn list_reporters(
    state: State<AppState>,
    deck_id: String,
) -> CommandResult<Vec<ReporterConfig>> {
    load_configs(&state, &deck_id)
}

/// Register a new Reporter for a deck; assigns and returns a `reporter_id`.
#[tauri::command]
pub fn add_reporter(
    state: State<AppState>,
    deck_id: String,
    mut config: ReporterConfig,
) -> CommandResult<ReporterConfig> {
    if config.reporter_id.is_empty() {
        config.reporter_id = ulid::Ulid::generate().to_string();
    }
    let mut configs = load_configs(&state, &deck_id)?;
    configs.push(config.clone());
    save_configs(&state, &deck_id, &configs)?;
    Ok(config)
}

/// Update an existing Reporter registration in place (matched by `reporter_id`,
/// which is preserved). Edits to `command`/`args`/`env` take effect on the next
/// `start_reporter`; a currently running child is not restarted here.
#[tauri::command]
pub fn update_reporter(
    state: State<AppState>,
    deck_id: String,
    config: ReporterConfig,
) -> CommandResult<ReporterConfig> {
    let mut configs = load_configs(&state, &deck_id)?;
    let slot = configs
        .iter_mut()
        .find(|c| c.reporter_id == config.reporter_id)
        .ok_or_else(|| CommandError {
            message: format!("No reporter registered with id {}", config.reporter_id),
        })?;
    *slot = config.clone();
    save_configs(&state, &deck_id, &configs)?;
    Ok(config)
}

/// List the ids of Reporters currently running. The registry spans decks, so the
/// caller intersects this with its own deck's registrations.
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
    deck_id: String,
    reporter_id: String,
) -> CommandResult<()> {
    stop_running(&registry, &reporter_id);
    let _ = app; // reserved for future teardown signalling
    let mut configs = load_configs(&state, &deck_id)?;
    configs.retain(|c| c.reporter_id != reporter_id);
    save_configs(&state, &deck_id, &configs)
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
    deck_id: String,
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

    let config = load_configs(&state, &deck_id)?
        .into_iter()
        .find(|c| c.reporter_id == reporter_id)
        .ok_or_else(|| CommandError {
            message: format!("No reporter registered with id {}", reporter_id),
        })?;

    let scope = std::sync::Arc::new(config.to_scope());
    let handle = app.clone();
    let deck_id_task = deck_id.clone();
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
            let deck_blocking = deck_id_task.clone();
            let scope_blocking = scope.clone();
            // The DB call is synchronous rusqlite behind a std Mutex; run it on a
            // blocking thread so the async worker isn't stalled while it holds the
            // lock. handle_message never awaits, so holding the lock here is safe.
            let handled = tauri::async_runtime::spawn_blocking(move || {
                let state = handle_blocking.state::<AppState>();
                let conn = state.conn.lock().unwrap_or_else(|e| e.into_inner());
                handle_message(&conn, &deck_blocking, &scope_blocking, &line_owned)
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
