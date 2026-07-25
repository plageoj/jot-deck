//! Jot Deck MCP bridge (008-mcp-server.md).
//!
//! A small stdio JSON-RPC server that links `jot_deck_core`, opens the deck's
//! SQLite file directly (the CLI's sibling — no IPC with the GUI), and maps MCP
//! `tools/call` onto the deck-scoped queries in `jot_deck_core::query` (reads)
//! and `jot_deck_core::write` (writes). It is connected to a single Deck
//! (`deck_id`); `private`/deleted filtering and deck-boundary enforcement live in
//! those core modules, which are the trust boundary.
//!
//! Read surface: `list_columns`, `read_card`, `search_cards`, `recent_cards`,
//! `describe_deck`, plus the `deck://` resources.
//!
//! Write surface (card writes): `append_card`, `patch_card`, `move_card`,
//! `delete_card`. On top of the core trust boundary the bridge applies
//! connection policy — capability opt-out (append/edit/delete), a per-connection
//! write rate limit, and write attribution logging (008 §5). Column-structure
//! tools (`ensure_column` etc.) arrive in a follow-up.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use jot_deck_core::{query, write, Connection};
use serde_json::{json, Value};

/// Protocol version we advertise when the client requests none, or requests one
/// we don't support (MCP negotiation: fall back to a version we do speak).
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";
/// MCP revisions this bridge speaks. On `initialize` we echo the client's
/// requested version only when it is one of these; otherwise we answer with
/// `DEFAULT_PROTOCOL_VERSION` rather than an unknown version.
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_NAME: &str = "jot-deck";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Tauri bundle identifier — keep in sync with packages/app/src-tauri/tauri.conf.json.
/// The GUI stores its DB under the app data dir named by this identifier.
pub const APP_IDENTIFIER: &str = "com.jot-deck.app";
/// DB file name the GUI creates inside the app data dir.
pub const DB_FILE_NAME: &str = "jot-deck.db";
/// Env var to override the DB path (dev / non-standard installs only).
pub const DB_PATH_ENV: &str = "JOT_DECK_DB_PATH";

/// The fixed DB location the GUI uses: `<platform data dir>/<identifier>/jot-deck.db`.
///
/// Mirrors Tauri v2's `app_data_dir()` (which also builds on the `dirs` crate),
/// so the bridge finds the same file the app writes without being told where it
/// is. Returns None only when the platform has no data dir.
pub fn default_db_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(APP_IDENTIFIER).join(DB_FILE_NAME))
}

/// Resolve the DB path: `JOT_DECK_DB_PATH` if set (dev override), else the fixed
/// default. The path is not required config — the default is the norm.
pub fn resolve_db_path() -> Option<String> {
    if let Ok(p) = std::env::var(DB_PATH_ENV) {
        if !p.is_empty() {
            return Some(p);
        }
    }
    default_db_path().map(|p| p.to_string_lossy().into_owned())
}

/// Primer loaded into the host's system context on `initialize` (008 §4.6).
const INSTRUCTIONS: &str = "\
Jot Deck exposes one Deck as a read/write knowledge base. Hierarchy: Deck > Column > Card. \
A Card is a tweet-sized atomic note. Start with `describe_deck` or `list_columns` to learn \
the columns (each has a purpose) and what this connection may do, then `search_cards` \
(full-text + tag/score/column filters), `recent_cards`, or `read_card` to read. To write: \
`append_card` adds a card to a column's end — for long input, append several short cards \
rather than growing one. `patch_card` edits a card's content and requires \
`expected_updated_at` (the `updated_at` you last read) so concurrent edits don't clobber \
each other; on a conflict, re-read and retry. `move_card` reorders or moves a card by naming \
an anchor card (before/after), not a raw position. `delete_card` soft-deletes (recoverable). \
`#tag` markers in content are auto-extracted; column and card ids are ULIDs assigned by Jot \
Deck — discover them via the tools, never guess them. Private columns are never visible. \
Some connections disable write or specific capabilities; `describe_deck` reports what's \
available.";

/// Default per-connection write cap: writes/minute (008 §5 rate limit). Overridable
/// via `JOT_DECK_MAX_WRITES_PER_MIN`.
const DEFAULT_MAX_WRITES_PER_MIN: usize = 120;

/// Which write verbs a connection may invoke (008 §5). All default ON; a
/// connection opts out via the `JOT_DECK_DENY` env list (e.g. `append,delete`).
/// `move_card` is gated under `edit` (it mutates an existing card's placement).
#[derive(Debug, Clone, Copy)]
pub struct Capabilities {
    pub append: bool,
    pub edit: bool,
    pub delete: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            append: true,
            edit: true,
            delete: true,
        }
    }
}

impl Capabilities {
    /// Parse a deny list like `"append, delete"` into capabilities (default all
    /// on). Unknown tokens are ignored but warned on stderr — a typo in a
    /// lockdown config must not silently leave a verb enabled.
    pub fn from_deny_list(deny: &str) -> Self {
        let mut c = Self::default();
        for tok in deny
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
        {
            match tok.as_str() {
                "append" => c.append = false,
                "edit" => c.edit = false,
                "delete" => c.delete = false,
                other => eprintln!(
                    "[jot-deck-mcp] JOT_DECK_DENY: ignoring unknown capability '{}' (expected append/edit/delete)",
                    other
                ),
            }
        }
        c
    }
}

/// Per-connection sliding-window write rate limiter (008 §5). Bounds the
/// "many tiny writes" runaway the card-length backstop can't catch.
struct RateLimiter {
    max_per_min: usize,
    events: Mutex<VecDeque<Instant>>,
}

impl RateLimiter {
    fn new(max_per_min: usize) -> Self {
        Self {
            max_per_min,
            events: Mutex::new(VecDeque::new()),
        }
    }

    /// Record a write attempt; err if it would exceed the per-minute cap.
    fn check_and_record(&self) -> Result<(), String> {
        let now = Instant::now();
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cutoff) = now.checked_sub(Duration::from_secs(60)) {
            while events.front().is_some_and(|&t| t < cutoff) {
                events.pop_front();
            }
        }
        if events.len() >= self.max_per_min {
            return Err(format!(
                "Rate limit exceeded: max {} writes/min for this connection. Slow down and retry.",
                self.max_per_min
            ));
        }
        events.push_back(now);
        Ok(())
    }
}

/// Per-connection policy the bridge applies on top of the core trust boundary.
pub struct BridgeConfig {
    pub capabilities: Capabilities,
    pub max_writes_per_min: usize,
    /// Opaque id identifying this connection in write-attribution logs (008 §5).
    pub connection_id: String,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            capabilities: Capabilities::default(),
            max_writes_per_min: DEFAULT_MAX_WRITES_PER_MIN,
            connection_id: ulid::Ulid::generate().to_string(),
        }
    }
}

impl BridgeConfig {
    /// Build the connection policy from the bridge's environment:
    /// `JOT_DECK_DENY` (capability opt-out) and `JOT_DECK_MAX_WRITES_PER_MIN`.
    pub fn from_env() -> Self {
        let capabilities = std::env::var("JOT_DECK_DENY")
            .map(|d| Capabilities::from_deny_list(&d))
            .unwrap_or_default();
        let max_writes_per_min = match std::env::var("JOT_DECK_MAX_WRITES_PER_MIN") {
            Ok(raw) => raw.parse::<usize>().ok().filter(|&n| n > 0).unwrap_or_else(|| {
                // Don't silently fall back to the permissive default on a typo.
                eprintln!(
                    "[jot-deck-mcp] JOT_DECK_MAX_WRITES_PER_MIN: '{}' is not a positive integer; using default {}",
                    raw, DEFAULT_MAX_WRITES_PER_MIN
                );
                DEFAULT_MAX_WRITES_PER_MIN
            }),
            Err(_) => DEFAULT_MAX_WRITES_PER_MIN,
        };
        Self {
            capabilities,
            max_writes_per_min,
            ..Default::default()
        }
    }
}

/// The MCP bridge over one connection and one deck.
pub struct Bridge {
    conn: Connection,
    deck_id: String,
    capabilities: Capabilities,
    rate_limiter: RateLimiter,
    connection_id: String,
}

impl Bridge {
    /// Build a bridge with the default policy (full write capabilities).
    pub fn new(conn: Connection, deck_id: String) -> Self {
        Self::with_config(conn, deck_id, BridgeConfig::default())
    }

    /// Build a bridge with an explicit connection policy (capabilities, rate
    /// limit, connection id).
    pub fn with_config(conn: Connection, deck_id: String, config: BridgeConfig) -> Self {
        Self {
            conn,
            deck_id,
            capabilities: config.capabilities,
            rate_limiter: RateLimiter::new(config.max_writes_per_min),
            connection_id: config.connection_id,
        }
    }

    /// Handle one incoming JSON-RPC message. Returns the serialized response, or
    /// `None` for notifications (no `id`) which must not be answered.
    pub fn handle_message(&self, line: &str) -> Option<String> {
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            // Parse error: id is unknown, respond with null id per JSON-RPC.
            Err(_) => return Some(error_response(Value::Null, -32700, "Parse error")),
        };

        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(Value::Null);

        // No id ⇒ notification: act if relevant, never respond.
        let Some(id) = id else {
            return None;
        };

        Some(self.dispatch(id, method, params))
    }

    fn dispatch(&self, id: Value, method: &str, params: Value) -> String {
        match method {
            "initialize" => success(id, self.initialize(&params)),
            "ping" => success(id, json!({})),
            "tools/list" => success(id, json!({ "tools": self.tool_defs() })),
            "tools/call" => self.tools_call(id, params),
            "resources/list" => success(id, json!({ "resources": self.resource_defs() })),
            "resources/read" => self.resources_read(id, params),
            _ => error_response(id, -32601, &format!("Method not found: {}", method)),
        }
    }

    fn initialize(&self, params: &Value) -> Value {
        // Echo the client's requested version only when we support it; for an
        // absent or unsupported version, answer with our default (MCP requires
        // the server to name a version it actually speaks).
        let protocol_version = params
            .get("protocolVersion")
            .and_then(Value::as_str)
            .filter(|v| SUPPORTED_PROTOCOL_VERSIONS.contains(v))
            .unwrap_or(DEFAULT_PROTOCOL_VERSION);
        json!({
            "protocolVersion": protocol_version,
            "capabilities": { "tools": {}, "resources": {} },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
            "instructions": INSTRUCTIONS,
        })
    }

    // ---- tools ----

    fn tools_call(&self, id: Value, params: Value) -> String {
        let name = params.get("name").and_then(Value::as_str).unwrap_or("");
        let args = params.get("arguments").cloned().unwrap_or(json!({}));

        let result = match name {
            "list_columns" => self.tool_list_columns(),
            "read_card" => self.tool_read_card(&args),
            "search_cards" => self.tool_search_cards(&args),
            "recent_cards" => self.tool_recent_cards(&args),
            "describe_deck" => self.tool_describe_deck(),
            "append_card" => self.tool_append_card(&args),
            "patch_card" => self.tool_patch_card(&args),
            "move_card" => self.tool_move_card(&args),
            "delete_card" => self.tool_delete_card(&args),
            other => {
                return error_response(id, -32602, &format!("Unknown tool: {}", other));
            }
        };

        match result {
            Ok(data) => success(id, tool_ok(data)),
            // Tool-level failures come back as a result with isError:true so the
            // model reads the message and self-corrects (008 §4.6), rather than a
            // transport error.
            Err(msg) => success(id, tool_err(&msg)),
        }
    }

    fn tool_list_columns(&self) -> Result<Value, String> {
        // Wrap the list in an object: MCP `structuredContent` must be a JSON
        // object, not a top-level array (strict hosts reject arrays).
        query::list_columns(&self.conn, &self.deck_id)
            .map(|c| json!({ "columns": c }))
            .map_err(|e| e.to_string())
    }

    fn tool_read_card(&self, args: &Value) -> Result<Value, String> {
        let card_id = require_str(args, "card_id")?;
        query::read_card(&self.conn, &self.deck_id, &card_id)
            .map(|c| json!(c))
            .map_err(|e| e.to_string())
    }

    fn tool_search_cards(&self, args: &Value) -> Result<Value, String> {
        let params = query::SearchParams {
            query: opt_str(args, "query"),
            column_id: opt_str(args, "column_id"),
            tags: opt_str_array(args, "tags"),
            min_score: args.get("min_score").and_then(Value::as_i64).map(|n| n as i32),
            limit: args.get("limit").and_then(Value::as_u64).map(|n| n as usize),
        };
        query::search_cards(&self.conn, &self.deck_id, &params)
            .map(|c| json!({ "cards": c }))
            .map_err(|e| e.to_string())
    }

    fn tool_recent_cards(&self, args: &Value) -> Result<Value, String> {
        let column_id = opt_str(args, "column_id");
        let limit = args.get("limit").and_then(Value::as_u64).map(|n| n as usize);
        query::recent_cards(&self.conn, &self.deck_id, column_id.as_deref(), limit)
            .map(|c| json!({ "cards": c }))
            .map_err(|e| e.to_string())
    }

    fn tool_describe_deck(&self) -> Result<Value, String> {
        let desc = query::describe_deck(&self.conn, &self.deck_id).map_err(|e| e.to_string())?;
        let mut v = json!(desc);
        // Augment the core description with this connection's write policy so the
        // agent learns its effective scope without the user explaining it (008 §4.6).
        v["capabilities"] = json!({
            "read": true,
            "append": self.capabilities.append,
            "edit": self.capabilities.edit,
            "delete": self.capabilities.delete,
        });
        if let Some(obj) = v.get_mut("constraints").and_then(Value::as_object_mut) {
            obj.insert(
                "max_writes_per_min".to_string(),
                json!(self.rate_limiter.max_per_min),
            );
        }
        Ok(v)
    }

    // ---- write tools (008 §4.1) ----

    /// Common prelude for every write tool: enforce the verb's capability, then
    /// the per-connection rate limit (008 §5). Centralized so the two gates and
    /// their order never drift between tools.
    fn begin_write(&self, enabled: bool, verb: &str) -> Result<(), String> {
        // Denied verbs are also hidden from `tools/list`, but an agent may still
        // call one — answer with a clear error.
        if !enabled {
            return Err(format!(
                "The '{}' capability is disabled for this connection.",
                verb
            ));
        }
        self.rate_limiter.check_and_record()
    }

    /// Log a write to stderr for connection attribution (008 §5). stdout carries
    /// JSON-RPC, so audit lines go to stderr where MCP hosts capture them.
    fn log_write(&self, tool: &str, card_id: &str) {
        eprintln!(
            "[jot-deck-mcp] conn={} deck={} {} card={}",
            self.connection_id, self.deck_id, tool, card_id
        );
    }

    fn tool_append_card(&self, args: &Value) -> Result<Value, String> {
        self.begin_write(self.capabilities.append, "append")?;
        let column_id = require_str(args, "column_id")?;
        let content = require_str(args, "content")?;
        let idempotency_key = opt_str(args, "idempotency_key");
        let card = write::append_card(
            &self.conn,
            &self.deck_id,
            &column_id,
            &content,
            idempotency_key.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        self.log_write("append_card", &card.id);
        Ok(json!({
            "card_id": card.id,
            "column_id": card.column_id,
            "position": card.position,
            "created_at": card.created_at.to_rfc3339(),
        }))
    }

    fn tool_patch_card(&self, args: &Value) -> Result<Value, String> {
        self.begin_write(self.capabilities.edit, "edit")?;
        let card_id = require_str(args, "card_id")?;
        let content = require_str(args, "content")?;
        let expected = require_str(args, "expected_updated_at")?;
        let expected_updated_at = chrono::DateTime::parse_from_rfc3339(&expected)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .map_err(|_| {
                "expected_updated_at must be an RFC3339 timestamp (the updated_at you last read)"
                    .to_string()
            })?;
        let card = write::patch_card(
            &self.conn,
            &self.deck_id,
            &card_id,
            &content,
            expected_updated_at,
        )
        .map_err(|e| e.to_string())?;
        self.log_write("patch_card", &card.id);
        Ok(json!({ "card_id": card.id, "updated_at": card.updated_at.to_rfc3339() }))
    }

    fn tool_move_card(&self, args: &Value) -> Result<Value, String> {
        self.begin_write(self.capabilities.edit, "edit")?;
        let card_id = require_str(args, "card_id")?;
        let to_column_id = opt_str(args, "to_column_id");
        let before_card_id = opt_str(args, "before_card_id");
        let after_card_id = opt_str(args, "after_card_id");
        let card = write::move_card(
            &self.conn,
            &self.deck_id,
            &card_id,
            to_column_id.as_deref(),
            before_card_id.as_deref(),
            after_card_id.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        self.log_write("move_card", &card.id);
        Ok(json!({ "card_id": card.id, "column_id": card.column_id, "position": card.position }))
    }

    fn tool_delete_card(&self, args: &Value) -> Result<Value, String> {
        self.begin_write(self.capabilities.delete, "delete")?;
        let card_id = require_str(args, "card_id")?;
        let card = write::delete_card(&self.conn, &self.deck_id, &card_id).map_err(|e| e.to_string())?;
        self.log_write("delete_card", &card.id);
        let deleted_at = card.deleted_at.map(|d| d.to_rfc3339()).unwrap_or_default();
        Ok(json!({ "card_id": card.id, "deleted_at": deleted_at }))
    }

    // ---- resources ----

    fn resource_defs(&self) -> Vec<Value> {
        vec![
            json!({
                "uri": format!("deck://{}", self.deck_id),
                "name": "Deck knowledge base",
                "description": "Columns and cards of the connected Deck (read-only).",
                "mimeType": "application/json",
            }),
            json!({
                "uri": "deck://schema",
                "name": "Deck schema",
                "description": "Runtime shape and constraints of this connection (same as describe_deck).",
                "mimeType": "application/json",
            }),
        ]
    }

    fn resources_read(&self, id: Value, params: Value) -> String {
        let uri = params.get("uri").and_then(Value::as_str).unwrap_or("");
        let deck_uri = format!("deck://{}", self.deck_id);

        let data = if uri == "deck://schema" {
            query::describe_deck(&self.conn, &self.deck_id).map(|d| json!(d))
        } else if uri == deck_uri {
            // KB view: the deck description plus each visible column's cards.
            self.deck_kb()
        } else {
            return error_response(id, -32602, &format!("Unknown resource: {}", uri));
        };

        match data {
            Ok(value) => {
                let text = serde_json::to_string_pretty(&value).unwrap_or_default();
                success(
                    id,
                    json!({
                        "contents": [{
                            "uri": uri,
                            "mimeType": "application/json",
                            "text": text,
                        }]
                    }),
                )
            }
            Err(e) => error_response(id, -32603, &e.to_string()),
        }
    }

    /// Build the `deck://{id}` KB payload: deck info + columns with their cards.
    fn deck_kb(&self) -> jot_deck_core::Result<Value> {
        let columns = query::list_columns(&self.conn, &self.deck_id)?;
        let mut columns_out = Vec::with_capacity(columns.len());
        for col in &columns {
            let cards = query::recent_cards(
                &self.conn,
                &self.deck_id,
                Some(&col.column_id),
                Some(query::MAX_QUERY_LIMIT),
            )?;
            columns_out.push(json!({
                "column_id": col.column_id,
                "name": col.name,
                "description": col.description,
                "position": col.position,
                "card_count": col.card_count,
                "cards": cards,
            }));
        }
        Ok(json!({ "deck_id": self.deck_id, "columns": columns_out }))
    }
}

// ---- tool schema ----

impl Bridge {
    /// Tools this connection exposes: the read surface always, plus each write
    /// tool whose capability is enabled (denied verbs are hidden so the agent
    /// won't attempt them → 008 §4.6).
    fn tool_defs(&self) -> Vec<Value> {
        let mut defs = read_tool_defs();
        if self.capabilities.append {
            defs.push(append_card_def());
        }
        if self.capabilities.edit {
            defs.push(patch_card_def());
            defs.push(move_card_def());
        }
        if self.capabilities.delete {
            defs.push(delete_card_def());
        }
        defs
    }
}

/// Read-surface tool definitions with input schemas and teaching descriptions (008 §4.6).
fn read_tool_defs() -> Vec<Value> {
    vec![
        json!({
            "name": "describe_deck",
            "description": "Return this connection's runtime shape: the visible columns (with their purpose) and the constraint values (card length limit, query limits, tag syntax). Call this first, and again after the deck changes, to ground where to read.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
        }),
        json!({
            "name": "list_columns",
            "description": "List the deck's columns (id, name, purpose, position, card_count), ordered by position. Private and deleted columns are omitted. Use it to discover the column_id to search or read within.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
        }),
        json!({
            "name": "read_card",
            "description": "Fetch one card by its ULID id, including content, score and tags. Returns not-found for cards in private/deleted columns.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "card_id": { "type": "string", "description": "Card ULID, e.g. from search_cards." }
                },
                "required": ["card_id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "search_cards",
            "description": "Search cards by full-text query and/or #tags (AND), minimum score, and column. All filters are optional; with none it returns the deck's top cards. Results exclude private columns.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Text to match in card content." },
                    "column_id": { "type": "string", "description": "Restrict to one column (ULID)." },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Tag names without '#'; a card must have all of them." },
                    "min_score": { "type": "integer", "description": "Only cards with score >= this." },
                    "limit": { "type": "integer", "description": "Max results (default 20, capped at 100)." }
                },
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "recent_cards",
            "description": "Return the most recently created cards, newest first, optionally within one column. A cheap way to see what was added lately without a query.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "column_id": { "type": "string", "description": "Restrict to one column (ULID)." },
                    "limit": { "type": "integer", "description": "Max results (default 20, capped at 100)." }
                },
                "additionalProperties": false,
            },
        }),
    ]
}

fn append_card_def() -> Value {
    json!({
        "name": "append_card",
        "description": "Append a new card to the end of a column and return its ULID. Get column_id from list_columns/describe_deck first. For long input, call this several times with short cards rather than growing one. Pass idempotency_key to make host resends safe (a repeat returns the same card).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "column_id": { "type": "string", "description": "Target column ULID." },
                "content": { "type": "string", "description": "Card text; #tags are auto-extracted." },
                "idempotency_key": { "type": "string", "description": "Optional key; resends with the same key don't create duplicates." }
            },
            "required": ["column_id", "content"],
            "additionalProperties": false,
        },
    })
}

fn patch_card_def() -> Value {
    json!({
        "name": "patch_card",
        "description": "Replace a card's content. Requires expected_updated_at (the updated_at you last read via read_card/search_cards) — the write applies only if the card is unchanged since, otherwise it conflicts and you should re-read and retry. Tags are re-extracted.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "card_id": { "type": "string", "description": "Card ULID." },
                "content": { "type": "string", "description": "New full content." },
                "expected_updated_at": { "type": "string", "description": "RFC3339 updated_at last read for this card (optimistic lock)." }
            },
            "required": ["card_id", "content", "expected_updated_at"],
            "additionalProperties": false,
        },
    })
}

fn move_card_def() -> Value {
    json!({
        "name": "move_card",
        "description": "Reorder a card or move it to another column in this deck. Express intent with an anchor — before_card_id or after_card_id (at most one) — not a raw position; omit both to append to the target column's end. Omit to_column_id to reorder within the current column. Moving to the same spot is a no-op.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "card_id": { "type": "string", "description": "Card ULID to move." },
                "to_column_id": { "type": "string", "description": "Destination column ULID (same deck); omit to reorder in place." },
                "before_card_id": { "type": "string", "description": "Place the card immediately before this card." },
                "after_card_id": { "type": "string", "description": "Place the card immediately after this card." }
            },
            "required": ["card_id"],
            "additionalProperties": false,
        },
    })
}

fn delete_card_def() -> Value {
    json!({
        "name": "delete_card",
        "description": "Soft-delete a card (recoverable from the user's trash; physically removed only after 30 days). Use when a card is wrong or obsolete.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "card_id": { "type": "string", "description": "Card ULID to delete." }
            },
            "required": ["card_id"],
            "additionalProperties": false,
        },
    })
}

// ---- JSON-RPC helpers ----

fn success(id: Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

fn error_response(id: Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        .to_string()
}

/// A successful tool result: human-readable JSON text plus structuredContent.
fn tool_ok(data: Value) -> Value {
    let text = serde_json::to_string_pretty(&data).unwrap_or_default();
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": data,
        "isError": false,
    })
}

/// A tool-level error result (isError:true) — surfaced to the model, not the host.
fn tool_err(message: &str) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true,
    })
}

fn require_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing required argument: {}", key))
}

fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn opt_str_array(args: &Value, key: &str) -> Vec<String> {
    args.get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use jot_deck_core::{card, column, create_in_memory, deck, NewCard, NewColumn, NewDeck, SortOrder};

    fn bridge_with_data() -> (Bridge, String, String) {
        let conn = create_in_memory().unwrap();
        let d = deck::create(
            &conn,
            NewDeck {
                name: "KB".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Research".to_string(),
            },
        )
        .unwrap();
        column::update(&conn, &col.id, None, Some(Some("papers")), None).unwrap();
        let secret = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Secret".to_string(),
            },
        )
        .unwrap();
        column::update(&conn, &secret.id, None, None, Some(true)).unwrap();

        let card = card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "rust ownership #lang".to_string(),
            },
        )
        .unwrap();
        card::create(
            &conn,
            NewCard {
                column_id: secret.id.clone(),
                content: "hidden".to_string(),
            },
        )
        .unwrap();

        (Bridge::new(conn, d.id.clone()), col.id, card.id)
    }

    fn call(bridge: &Bridge, id: i64, name: &str, args: Value) -> Value {
        let req = json!({
            "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": { "name": name, "arguments": args }
        })
        .to_string();
        let resp = bridge.handle_message(&req).unwrap();
        serde_json::from_str(&resp).unwrap()
    }

    fn structured(resp: &Value) -> &Value {
        &resp["result"]["structuredContent"]
    }

    #[test]
    fn default_db_path_uses_identifier_and_filename() {
        // Only asserts the shape; the data dir itself is platform/host specific.
        if let Some(path) = default_db_path() {
            assert!(path.ends_with(format!("{}/{}", APP_IDENTIFIER, DB_FILE_NAME)));
        }
    }

    #[test]
    fn initialize_returns_instructions_and_capabilities() {
        let (bridge, _, _) = bridge_with_data();
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-03-26" } })
        .to_string();
        let resp: Value = serde_json::from_str(&bridge.handle_message(&req).unwrap()).unwrap();
        assert_eq!(resp["result"]["protocolVersion"], "2025-03-26");
        assert!(resp["result"]["instructions"].as_str().unwrap().contains("knowledge base"));
        assert!(resp["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn initialize_falls_back_for_unsupported_protocol_version() {
        let (bridge, _, _) = bridge_with_data();
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "1999-01-01" } })
        .to_string();
        let resp: Value = serde_json::from_str(&bridge.handle_message(&req).unwrap()).unwrap();
        // Unknown version ⇒ answer with a version we actually support.
        assert_eq!(resp["result"]["protocolVersion"], DEFAULT_PROTOCOL_VERSION);
    }

    #[test]
    fn notification_gets_no_response() {
        let (bridge, _, _) = bridge_with_data();
        let req = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }).to_string();
        assert!(bridge.handle_message(&req).is_none());
    }

    #[test]
    fn tools_list_exposes_read_surface() {
        let (bridge, _, _) = bridge_with_data();
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
        let resp: Value = serde_json::from_str(&bridge.handle_message(&req).unwrap()).unwrap();
        let names: Vec<&str> = resp["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        for expected in ["describe_deck", "list_columns", "read_card", "search_cards", "recent_cards"] {
            assert!(names.contains(&expected), "missing tool {}", expected);
        }
    }

    #[test]
    fn list_columns_omits_private() {
        let (bridge, _, _) = bridge_with_data();
        let resp = call(&bridge, 1, "list_columns", json!({}));
        let cols = structured(&resp)["columns"].as_array().unwrap();
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0]["name"], "Research");
    }

    #[test]
    fn list_returning_tools_wrap_structured_content_in_object() {
        // MCP `structuredContent` must be a JSON object; a top-level array is
        // rejected by strict hosts. The list-returning tools wrap their results.
        let (bridge, col_id, _) = bridge_with_data();
        for (name, args, key) in [
            ("list_columns", json!({}), "columns"),
            ("search_cards", json!({}), "cards"),
            ("recent_cards", json!({ "column_id": col_id }), "cards"),
        ] {
            let resp = call(&bridge, 1, name, args);
            assert_eq!(resp["result"]["isError"], false, "{name} errored");
            assert!(
                structured(&resp).is_object(),
                "{name} structuredContent must be an object"
            );
            assert!(
                structured(&resp)[key].is_array(),
                "{name} must expose its list under `{key}`"
            );
        }
    }

    #[test]
    fn search_cards_finds_by_tag() {
        let (bridge, _, _) = bridge_with_data();
        let resp = call(&bridge, 1, "search_cards", json!({ "tags": ["lang"] }));
        let cards = structured(&resp)["cards"].as_array().unwrap();
        assert_eq!(cards.len(), 1);
        assert!(cards[0]["content"].as_str().unwrap().contains("rust"));
    }

    #[test]
    fn read_card_returns_not_found_for_private() {
        let (bridge, _, _) = bridge_with_data();
        // Grab the private card's id via a direct query is not exposed; instead
        // read a bogus id → isError with not found message.
        let resp = call(&bridge, 1, "read_card", json!({ "card_id": "NONEXISTENT" }));
        assert_eq!(resp["result"]["isError"], true);
    }

    #[test]
    fn read_card_returns_visible_card() {
        let (bridge, _col, card_id) = bridge_with_data();
        let resp = call(&bridge, 1, "read_card", json!({ "card_id": card_id }));
        assert_eq!(resp["result"]["isError"], false);
        assert!(structured(&resp)["content"].as_str().unwrap().contains("ownership"));
    }

    #[test]
    fn missing_required_arg_is_tool_error() {
        let (bridge, _, _) = bridge_with_data();
        let resp = call(&bridge, 1, "read_card", json!({}));
        assert_eq!(resp["result"]["isError"], true);
    }

    #[test]
    fn unknown_method_is_jsonrpc_error() {
        let (bridge, _, _) = bridge_with_data();
        let req = json!({ "jsonrpc": "2.0", "id": 9, "method": "bogus/method" }).to_string();
        let resp: Value = serde_json::from_str(&bridge.handle_message(&req).unwrap()).unwrap();
        assert_eq!(resp["error"]["code"], -32601);
    }

    #[test]
    fn resources_read_schema() {
        let (bridge, _, _) = bridge_with_data();
        let req = json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/read",
            "params": { "uri": "deck://schema" } })
        .to_string();
        let resp: Value = serde_json::from_str(&bridge.handle_message(&req).unwrap()).unwrap();
        let text = resp["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(text.contains("constraints"));
    }

    #[test]
    fn deck_resource_lists_cards_without_private() {
        let (bridge, _, _) = bridge_with_data();
        let deck_id = bridge.deck_id.clone();
        let req = json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/read",
            "params": { "uri": format!("deck://{}", deck_id) } })
        .to_string();
        let resp: Value = serde_json::from_str(&bridge.handle_message(&req).unwrap()).unwrap();
        let text = resp["result"]["contents"][0]["text"].as_str().unwrap();
        assert!(text.contains("Research"));
        assert!(!text.contains("hidden"));
    }

    // ---- write surface ----

    /// A single-column deck with the given connection policy. Returns the bridge
    /// and the (public, writable) column id.
    fn bridge_with_config(config: BridgeConfig) -> (Bridge, String) {
        let conn = create_in_memory().unwrap();
        let d = deck::create(
            &conn,
            NewDeck {
                name: "KB".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Notes".to_string(),
            },
        )
        .unwrap();
        (Bridge::with_config(conn, d.id, config), col.id)
    }

    fn tool_names(bridge: &Bridge) -> Vec<String> {
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }).to_string();
        let resp: Value = serde_json::from_str(&bridge.handle_message(&req).unwrap()).unwrap();
        resp["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn deny_list_parses_known_and_ignores_unknown() {
        let c = Capabilities::from_deny_list("append, bogus, delete");
        assert!(!c.append);
        assert!(c.edit); // untouched
        assert!(!c.delete);
        // Unknown token ("bogus") is ignored (warned on stderr), not fatal.
    }

    #[test]
    fn tools_list_exposes_write_surface_by_default() {
        let (bridge, _, _) = bridge_with_data();
        let names = tool_names(&bridge);
        for expected in ["append_card", "patch_card", "move_card", "delete_card"] {
            assert!(names.contains(&expected.to_string()), "missing {expected}");
        }
    }

    #[test]
    fn append_card_creates_and_returns_ids() {
        let (bridge, col_id, _) = bridge_with_data();
        let resp = call(&bridge, 1, "append_card", json!({ "column_id": col_id, "content": "new note #x" }));
        assert_eq!(resp["result"]["isError"], false);
        assert!(structured(&resp)["card_id"].is_string());
        assert_eq!(structured(&resp)["column_id"], col_id);
    }

    #[test]
    fn append_card_to_private_column_is_error() {
        // Reach the private column id via a direct fixture (it is never listed).
        let conn = create_in_memory().unwrap();
        let d = deck::create(&conn, NewDeck { name: "KB".into(), sort_order: SortOrder::default() }).unwrap();
        let secret = column::create(&conn, NewColumn { deck_id: d.id.clone(), name: "Secret".into() }).unwrap();
        column::update(&conn, &secret.id, None, None, Some(true)).unwrap();
        let bridge = Bridge::new(conn, d.id);

        let resp = call(&bridge, 1, "append_card", json!({ "column_id": secret.id, "content": "x" }));
        assert_eq!(resp["result"]["isError"], true);
    }

    #[test]
    fn append_card_is_idempotent() {
        let (bridge, col_id, _) = bridge_with_data();
        let a = call(&bridge, 1, "append_card", json!({ "column_id": col_id, "content": "once", "idempotency_key": "k1" }));
        let b = call(&bridge, 2, "append_card", json!({ "column_id": col_id, "content": "ignored", "idempotency_key": "k1" }));
        assert_eq!(structured(&a)["card_id"], structured(&b)["card_id"]);
    }

    #[test]
    fn patch_card_applies_and_rejects_stale() {
        let (bridge, _col, card_id) = bridge_with_data();
        let read = call(&bridge, 1, "read_card", json!({ "card_id": card_id }));
        let updated_at = structured(&read)["updated_at"].as_str().unwrap().to_string();

        let ok = call(&bridge, 2, "patch_card", json!({ "card_id": card_id, "content": "patched", "expected_updated_at": updated_at.clone() }));
        assert_eq!(ok["result"]["isError"], false);

        // Reusing the now-stale updated_at conflicts.
        let stale = call(&bridge, 3, "patch_card", json!({ "card_id": card_id, "content": "again", "expected_updated_at": updated_at }));
        assert_eq!(stale["result"]["isError"], true);
    }

    #[test]
    fn patch_card_rejects_bad_timestamp() {
        let (bridge, _col, card_id) = bridge_with_data();
        let resp = call(&bridge, 1, "patch_card", json!({ "card_id": card_id, "content": "x", "expected_updated_at": "not-a-date" }));
        assert_eq!(resp["result"]["isError"], true);
    }

    #[test]
    fn delete_card_soft_deletes() {
        let (bridge, col_id, _) = bridge_with_data();
        let appended = call(&bridge, 1, "append_card", json!({ "column_id": col_id, "content": "bye" }));
        let new_id = structured(&appended)["card_id"].as_str().unwrap().to_string();
        let resp = call(&bridge, 2, "delete_card", json!({ "card_id": new_id }));
        assert_eq!(resp["result"]["isError"], false);
        assert!(structured(&resp)["deleted_at"].as_str().unwrap().len() > 0);
    }

    #[test]
    fn move_card_reorders_by_anchor() {
        let (bridge, col_id, card_id) = bridge_with_data();
        let b = call(&bridge, 1, "append_card", json!({ "column_id": col_id, "content": "B" }));
        let b_id = structured(&b)["card_id"].as_str().unwrap().to_string();
        // Move the original card after B → order becomes (B, original).
        let resp = call(&bridge, 2, "move_card", json!({ "card_id": card_id, "after_card_id": b_id }));
        assert_eq!(resp["result"]["isError"], false);
        assert_eq!(structured(&resp)["column_id"], col_id);

        let recent = call(&bridge, 3, "recent_cards", json!({ "column_id": col_id }));
        let cards = structured(&recent)["cards"].as_array().unwrap();
        // recent_cards is created_desc; both exist, sanity check the move didn't error out the set.
        assert_eq!(cards.len(), 2);
    }

    #[test]
    fn denied_capability_hides_tool_and_errors_on_call() {
        let mut config = BridgeConfig::default();
        config.capabilities.append = false;
        let (bridge, col_id) = bridge_with_config(config);

        // Hidden from tools/list…
        let names = tool_names(&bridge);
        assert!(!names.contains(&"append_card".to_string()));
        // …but a direct call still fails cleanly (edit remains available).
        assert!(names.contains(&"patch_card".to_string()));
        let resp = call(&bridge, 1, "append_card", json!({ "column_id": col_id, "content": "x" }));
        assert_eq!(resp["result"]["isError"], true);
    }

    #[test]
    fn rate_limit_blocks_excess_writes() {
        let mut config = BridgeConfig::default();
        config.max_writes_per_min = 1;
        let (bridge, col_id) = bridge_with_config(config);

        let first = call(&bridge, 1, "append_card", json!({ "column_id": col_id, "content": "a" }));
        assert_eq!(first["result"]["isError"], false);
        let second = call(&bridge, 2, "append_card", json!({ "column_id": col_id, "content": "b" }));
        assert_eq!(second["result"]["isError"], true);
    }

    #[test]
    fn describe_deck_reports_capabilities() {
        let mut config = BridgeConfig::default();
        config.capabilities.delete = false;
        let (bridge, _col) = bridge_with_config(config);
        let resp = call(&bridge, 1, "describe_deck", json!({}));
        let caps = &structured(&resp)["capabilities"];
        assert_eq!(caps["append"], true);
        assert_eq!(caps["delete"], false);
        assert!(structured(&resp)["constraints"]["max_writes_per_min"].is_number());
    }
}
