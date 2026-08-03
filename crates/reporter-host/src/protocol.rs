//! JSON-RPC 2.0 envelope + Reporter-protocol request/result types (007 §6.1).
//!
//! The Reporter is the client: it sends requests over its stdout, the host (Jot
//! Deck) answers on the Reporter's stdin. This module holds the wire types and
//! the error-code mapping; the actual method → core mapping lives in `dispatch`.
//!
//! Phase 1 covers the *committed* channel only (007 §6.1). The ephemeral stream
//! (`card.stream.begin/delta/end`, occupancy lock) is Phase 2 and not defined here.

use jot_deck_core::JotDeckError;
use serde::Deserialize;
use serde_json::{json, Value};

/// A JSON-RPC error to return to the Reporter: an application code plus a
/// message. Kept small so `dispatch` can build one from a domain error and
/// `handle_message` can serialize it into the response envelope.
#[derive(Debug, Clone)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

// JSON-RPC reserved codes (spec) used at the transport layer.
pub const PARSE_ERROR: i64 = -32700;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;

// Application-defined codes (server-error range) mapping the domain errors the
// Reporter must distinguish (007 §6.1 / §7): scope/CAS/rate-limit outcomes.
pub const UNAUTHORIZED: i64 = -32001;
pub const NOT_FOUND: i64 = -32002;
pub const INVALID_OPERATION: i64 = -32003;
/// CAS mismatch or occupancy conflict (002 §5) — re-read and retry.
pub const CONFLICT: i64 = -32004;
/// Capability disabled or per-Reporter rate limit exceeded (007 §10 scope).
pub const POLICY_DENIED: i64 = -32005;

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// A bad/missing argument in `params` (before any core call).
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(INVALID_PARAMS, message)
    }

    /// A capability/rate-limit refusal raised by the Reporter scope (not core).
    pub fn policy_denied(message: impl Into<String>) -> Self {
        Self::new(POLICY_DENIED, message)
    }
}

/// Map a core domain error onto a JSON-RPC application error. The trust boundary
/// (`jot_deck_core::write`/`query`) already speaks these variants, so the code
/// mapping stays in one place and every method inherits it.
impl From<JotDeckError> for RpcError {
    fn from(e: JotDeckError) -> Self {
        let code = match e {
            JotDeckError::Unauthorized(_) => UNAUTHORIZED,
            JotDeckError::NotFound(_) => NOT_FOUND,
            JotDeckError::InvalidOperation(_) => INVALID_OPERATION,
            JotDeckError::Conflict(_) => CONFLICT,
            // A raw SQLite error is an internal failure, not something the
            // Reporter can act on — surface it as an invalid-operation message.
            JotDeckError::Database(_) => INVALID_OPERATION,
        };
        RpcError::new(code, e.to_string())
    }
}

/// Build a JSON-RPC success response line.
pub fn success_response(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// Build a JSON-RPC error response line.
pub fn error_response(id: &Value, err: &RpcError) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": err.code, "message": err.message },
    })
    .to_string()
}

/// Deserialize a method's `params` into its typed struct, turning a shape
/// mismatch into an `invalid_params` error rather than a panic.
pub fn parse_params<T: for<'de> Deserialize<'de>>(params: &Value) -> Result<T, RpcError> {
    // Treat an absent `params` as an empty object so methods with all-optional
    // fields (e.g. deck.recent_cards) work when the Reporter omits it.
    let params = if params.is_null() {
        json!({})
    } else {
        params.clone()
    };
    serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("Invalid params: {}", e)))
}

// ---- Method param types (007 §6.1) ----

/// `card.append` — create a card at a column's end. The host assigns the ULID /
/// position and extracts `#tag`s; `idempotency_key` makes a resend a no-op.
#[derive(Debug, Deserialize)]
pub struct AppendParams {
    pub column_id: String,
    pub content: String,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// `card.patch` (alias `card.commit`) — confirmed edit guarded by optimistic
/// lock. `expected_updated_at` is the `updated_at` the Reporter last read (002 §5.3).
#[derive(Debug, Deserialize)]
pub struct PatchParams {
    pub card_id: String,
    pub content: String,
    pub expected_updated_at: String,
}

/// `card.read` — read a single card back (context / patch-target identification).
#[derive(Debug, Deserialize)]
pub struct ReadParams {
    pub card_id: String,
}

/// `card.move` — move / reorder a card by an anchor. `to_column_id` omitted means
/// reorder within the current column; `before`/`after` omitted means the target
/// column's end. The host assigns the position value.
#[derive(Debug, Deserialize)]
pub struct MoveCardParams {
    pub card_id: String,
    #[serde(default)]
    pub to_column_id: Option<String>,
    #[serde(default)]
    pub before_card_id: Option<String>,
    #[serde(default)]
    pub after_card_id: Option<String>,
}

/// `card.delete` — soft-delete a card (recoverable via the user's delete stack).
#[derive(Debug, Deserialize)]
pub struct DeleteParams {
    pub card_id: String,
}

/// `deck.recent_cards` — the query-less "what happened lately" path.
#[derive(Debug, Deserialize)]
pub struct RecentCardsParams {
    #[serde(default)]
    pub column_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// `deck.search_cards` — FTS5 + tag/score/column filter (context lookup).
#[derive(Debug, Deserialize)]
pub struct SearchCardsParams {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub column_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub min_score: Option<i32>,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// `column.ensure` — get-or-create by name (idempotent). The host assigns the
/// ULID / position; `created` tells the Reporter which happened.
#[derive(Debug, Deserialize)]
pub struct EnsureColumnParams {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub private: bool,
}

/// `column.update` — patch name / description / private (only the given fields).
///
/// `description` distinguishes three cases: absent (leave), present-empty
/// (clear to NULL), present-nonempty (set). `Option<Option<String>>` with
/// `default` captures absent vs present; the inner is normalized in `dispatch`.
#[derive(Debug, Deserialize)]
pub struct UpdateColumnParams {
    pub column_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub private: Option<bool>,
}

/// `card.stream.begin` — acquire the occupancy lock on an existing card so the
/// Reporter owns it for the duration of the stream (007 §6.2 / §7).
#[derive(Debug, Deserialize)]
pub struct StreamBeginParams {
    pub card_id: String,
}

/// `card.stream.end` — commit the final text and release the lock. No
/// `expected_updated_at`: the occupancy lock (not CAS) is the concurrency
/// control while streaming.
#[derive(Debug, Deserialize)]
pub struct StreamEndParams {
    pub card_id: String,
    pub content: String,
}

/// `card.stream.delta` — a mid-stream chunk. Ephemeral: it never touches the DB,
/// so it is parsed by `peek_ephemeral` and pushed straight to the frontend
/// overlay rather than going through `dispatch` (007 §4 / §8.2).
#[derive(Debug, Clone, Deserialize)]
pub struct StreamDelta {
    pub card_id: String,
    pub chunk: String,
}

/// `column.move` — reorder by an anchor (`before`/`after`, one of them; omit for
/// the deck's end). The host assigns the position value.
#[derive(Debug, Deserialize)]
pub struct MoveColumnParams {
    pub column_id: String,
    #[serde(default)]
    pub before_column_id: Option<String>,
    #[serde(default)]
    pub after_column_id: Option<String>,
}

/// Deserialize helper so an explicit JSON `null` maps to `Some(None)` (clear)
/// while an absent key maps to `None` (leave) — the distinction `update_column`
/// needs for `description`.
fn double_option<'de, D>(de: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // If the key is present at all, deserialize its value as Option<String>;
    // serde only calls this fn when the key exists (paired with `default`).
    Ok(Some(Option::<String>::deserialize(de)?))
}
