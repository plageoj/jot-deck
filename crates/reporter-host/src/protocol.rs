//! JSON-RPC 2.0 envelope and error codes of the Reporter protocol (007 §6.1).
//!
//! The Reporter is the client: it sends requests over its stdout, the host (Jot
//! Deck) answers on the Reporter's stdin. This module holds the envelope, the
//! error-code mapping and the ephemeral `card.stream.delta` payload; method
//! arguments are parsed by `jot_deck_core::access`, shared with the MCP bridge.

use jot_deck_core::access::AccessError;
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
/// Capability disabled or per-Reporter rate limit exceeded (007 §2.3 scope).
pub const POLICY_DENIED: i64 = -32005;

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

}

/// Map an access-layer failure: policy refusals and bad arguments get their own
/// codes, core domain errors go through the `JotDeckError` mapping below.
impl From<AccessError> for RpcError {
    fn from(e: AccessError) -> Self {
        match e {
            AccessError::Denied(msg) => RpcError::new(POLICY_DENIED, msg),
            AccessError::InvalidArgs(msg) => RpcError::new(INVALID_PARAMS, msg),
            AccessError::Core(e) => e.into(),
        }
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

/// `card.stream.delta` — a mid-stream chunk. Ephemeral: it never touches the DB,
/// so it is parsed by `peek_ephemeral` and pushed straight to the frontend
/// overlay rather than going through `dispatch` (007 §4 / §8.2).
#[derive(Debug, Clone, Deserialize)]
pub struct StreamDelta {
    pub card_id: String,
    pub chunk: String,
}
