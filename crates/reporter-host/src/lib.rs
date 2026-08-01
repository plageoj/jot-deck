//! Jot Deck Reporter host — committed channel (007-reporter-protocol.md, Phase 1).
//!
//! The Reporter host is the *inverse* of the MCP bridge (`crates/mcp`). There,
//! Claude spawns the bridge and the bridge opens the DB directly. Here, **Jot
//! Deck spawns the Reporter and owns the pipe** (007 §2.2), so the host is the
//! JSON-RPC *server*: it reads requests from the child's stdout and answers on
//! the child's stdin. This crate holds the transport-agnostic core of that
//! server — envelope parsing, method dispatch onto `jot_deck_core::write`/`query`,
//! and the per-Reporter scope — so it is unit-testable against an in-memory DB.
//! The Tauri layer (`packages/app/src-tauri/src/reporter.rs`) owns spawning, the
//! stdio pump, and frontend change events.
//!
//! Phase 1 = the committed channel only (`card.append`/`patch`/`read`, `deck.*`,
//! `column.ensure`/`update`/`move`). The ephemeral stream (`card.stream.*`) and
//! the occupancy lock (002 §5.2) are Phase 2.

mod dispatch;
mod protocol;
mod scope;

pub use dispatch::{dispatch, Committed, DispatchOutcome};
pub use protocol::RpcError;
pub use scope::{Capabilities, ReporterScope, DEFAULT_MAX_WRITES_PER_MIN};

use jot_deck_core::Connection;
use serde_json::Value;

/// The outcome of handling one line: the response to write back (always present
/// in Phase 1 — every committed-channel method is request/response), plus what
/// the write changed so the host can emit a frontend event.
pub struct Handled {
    /// Serialized JSON-RPC response line to write to the Reporter's stdin, or
    /// `None` for a notification (no `id`), which must not be answered.
    pub response: Option<String>,
    /// Set when the call committed a write (for the host's change event).
    pub committed: Option<Committed>,
}

/// Handle one incoming JSON-RPC line from a Reporter against `conn`/`deck_id`
/// under `scope`. Mirrors `Bridge::handle_message`: parse the envelope, treat a
/// missing `id` as a notification (no reply), otherwise dispatch and build the
/// success/error response.
pub fn handle_message(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    line: &str,
) -> Handled {
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            // Parse error: the id is unknown, so answer with a null id per JSON-RPC.
            return Handled {
                response: Some(protocol::error_response(
                    &Value::Null,
                    &RpcError::new(protocol::PARSE_ERROR, "Parse error"),
                )),
                committed: None,
            };
        }
    };

    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    // No id ⇒ notification: never respond. The committed channel always carries
    // an id, so a notification here is out-of-protocol and simply ignored.
    let Some(id) = id else {
        return Handled {
            response: None,
            committed: None,
        };
    };

    match dispatch(conn, deck_id, scope, method, &params) {
        Ok(outcome) => Handled {
            response: Some(protocol::success_response(&id, outcome.result)),
            committed: outcome.committed,
        },
        Err(err) => Handled {
            response: Some(protocol::error_response(&id, &err)),
            committed: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jot_deck_core::{
        card, column, create_in_memory, deck, Connection, NewCard, NewColumn, NewDeck, SortOrder,
    };
    use serde_json::json;

    /// Build an in-memory deck with a visible "Research" column (one card) and a
    /// `private` "Secret" column (one card), matching the MCP bridge test fixture.
    fn deck_with_data() -> (Connection, String, String, String, String) {
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
        let cardrow = card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "rust ownership #lang".to_string(),
            },
        )
        .unwrap();
        (conn, d.id, col.id, secret.id, cardrow.id)
    }

    /// Send one request and return the parsed response Value plus the committed
    /// signal, using the default (all-enabled) scope.
    fn call(
        conn: &Connection,
        deck_id: &str,
        method: &str,
        params: Value,
    ) -> (Value, Option<Committed>) {
        call_scoped(conn, deck_id, &ReporterScope::default(), method, params)
    }

    fn call_scoped(
        conn: &Connection,
        deck_id: &str,
        scope: &ReporterScope,
        method: &str,
        params: Value,
    ) -> (Value, Option<Committed>) {
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
            .to_string();
        let handled = handle_message(conn, deck_id, scope, &req);
        let resp: Value = serde_json::from_str(&handled.response.unwrap()).unwrap();
        (resp, handled.committed)
    }

    #[test]
    fn append_creates_card_and_signals_committed() {
        let (conn, deck_id, col_id, _, _) = deck_with_data();
        let (resp, committed) = call(
            &conn,
            &deck_id,
            "card.append",
            json!({ "column_id": col_id, "content": "new note #x" }),
        );
        assert_eq!(resp["result"]["column_id"], col_id);
        assert!(resp["result"]["card_id"].is_string());
        assert!(matches!(committed, Some(Committed::Card { .. })));
    }

    #[test]
    fn append_idempotency_key_returns_same_card() {
        let (conn, deck_id, col_id, _, _) = deck_with_data();
        let args = json!({ "column_id": col_id, "content": "once", "idempotency_key": "k1" });
        let (a, _) = call(&conn, &deck_id, "card.append", args.clone());
        let (b, _) = call(&conn, &deck_id, "card.append", args);
        assert_eq!(a["result"]["card_id"], b["result"]["card_id"]);
    }

    #[test]
    fn append_to_private_column_is_unauthorized() {
        let (conn, deck_id, _, secret_id, _) = deck_with_data();
        let (resp, committed) = call(
            &conn,
            &deck_id,
            "card.append",
            json!({ "column_id": secret_id, "content": "leak" }),
        );
        // Core enforces the private exclusion → Unauthorized, no commit.
        assert_eq!(resp["error"]["code"], protocol::UNAUTHORIZED);
        assert!(committed.is_none());
    }

    #[test]
    fn patch_requires_matching_updated_at_cas() {
        let (conn, deck_id, _, _, card_id) = deck_with_data();
        // A stale/mismatched expected_updated_at must be rejected as a conflict.
        let (resp, _) = call(
            &conn,
            &deck_id,
            "card.patch",
            json!({
                "card_id": card_id,
                "content": "edited",
                "expected_updated_at": "2000-01-01T00:00:00Z",
            }),
        );
        assert_eq!(resp["error"]["code"], protocol::CONFLICT);
    }

    #[test]
    fn patch_with_bad_timestamp_is_invalid_params() {
        let (conn, deck_id, _, _, card_id) = deck_with_data();
        let (resp, _) = call(
            &conn,
            &deck_id,
            "card.patch",
            json!({ "card_id": card_id, "content": "x", "expected_updated_at": "nope" }),
        );
        assert_eq!(resp["error"]["code"], protocol::INVALID_PARAMS);
    }

    #[test]
    fn read_card_hides_private_as_not_found() {
        let (conn, deck_id, _col_id, secret_id, _vis_card) = deck_with_data();
        // Put a card in the private column, then confirm it reads back as
        // NotFound (its existence is not leaked across the write/read boundary).
        let hidden_id = card::create(
            &conn,
            NewCard {
                column_id: secret_id.clone(),
                content: "hidden".to_string(),
            },
        )
        .unwrap()
        .id;
        let (resp, _) = call(&conn, &deck_id, "card.read", json!({ "card_id": hidden_id }));
        assert_eq!(resp["error"]["code"], protocol::NOT_FOUND);
    }

    #[test]
    fn list_columns_excludes_private() {
        let (conn, deck_id, _, _, _) = deck_with_data();
        let (resp, _) = call(&conn, &deck_id, "deck.list_columns", json!({}));
        let cols = resp["result"]["columns"].as_array().unwrap();
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0]["name"], "Research");
    }

    #[test]
    fn ensure_column_is_idempotent_by_name() {
        let (conn, deck_id, _, _, _) = deck_with_data();
        let args = json!({ "name": "Research", "description": "papers" });
        let (a, committed) = call(&conn, &deck_id, "column.ensure", args);
        assert_eq!(a["result"]["created"], false);
        assert!(matches!(committed, Some(Committed::Structure)));
        let (b, _) = call(
            &conn,
            &deck_id,
            "column.ensure",
            json!({ "name": "Brand New", "description": "d" }),
        );
        assert_eq!(b["result"]["created"], true);
    }

    #[test]
    fn deny_append_disables_capability() {
        let (conn, deck_id, col_id, _, _) = deck_with_data();
        let scope = ReporterScope::new(
            Capabilities::from_deny_list("append"),
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "r1".to_string(),
        );
        let (resp, committed) = call_scoped(
            &conn,
            &deck_id,
            &scope,
            "card.append",
            json!({ "column_id": col_id, "content": "x" }),
        );
        assert_eq!(resp["error"]["code"], protocol::POLICY_DENIED);
        assert!(committed.is_none());
    }

    #[test]
    fn write_allowlist_rejects_outside_column_and_blocks_create() {
        let (conn, deck_id, col_id, _, _) = deck_with_data();
        // Allowlist naming only the visible column.
        let scope = ReporterScope::new(
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            Some(vec![col_id.clone()]),
            "r1".to_string(),
        );
        // Append to an allowed column succeeds.
        let (ok, _) = call_scoped(
            &conn,
            &deck_id,
            &scope,
            "card.append",
            json!({ "column_id": col_id, "content": "in scope" }),
        );
        assert!(ok["result"]["card_id"].is_string());
        // Append to a made-up column id outside the allowlist is Unauthorized.
        let (bad, _) = call_scoped(
            &conn,
            &deck_id,
            &scope,
            "card.append",
            json!({ "column_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "content": "x" }),
        );
        assert_eq!(bad["error"]["code"], protocol::UNAUTHORIZED);
        // With an allowlist set, ensure_column may still *get* an existing column
        // but must not *create* a new one.
        let (created, _) = call_scoped(
            &conn,
            &deck_id,
            &scope,
            "column.ensure",
            json!({ "name": "Fresh", "description": "d" }),
        );
        assert!(created["error"].is_object());
    }

    #[test]
    fn unknown_method_is_method_not_found() {
        let (conn, deck_id, _, _, _) = deck_with_data();
        let (resp, _) = call(&conn, &deck_id, "card.explode", json!({}));
        assert_eq!(resp["error"]["code"], protocol::METHOD_NOT_FOUND);
    }

    #[test]
    fn notification_without_id_is_not_answered() {
        let (conn, deck_id, _, _, _) = deck_with_data();
        let req = json!({ "jsonrpc": "2.0", "method": "ping" }).to_string();
        let handled = handle_message(&conn, &deck_id, &ReporterScope::default(), &req);
        assert!(handled.response.is_none());
    }
}
