//! Jot Deck Reporter host (007-reporter-protocol.md).
//!
//! The Reporter host is the *inverse* of the MCP bridge (`crates/mcp`). There,
//! Claude spawns the bridge and the bridge opens the DB directly. Here, **Jot
//! Deck spawns the Reporter and owns the pipe** (007 §2.2), so the host is the
//! JSON-RPC *server*: it reads requests from the child's stdout and answers on
//! the child's stdin. This crate holds the transport-agnostic core of that
//! server — envelope parsing, method dispatch onto `jot_deck_core::access` (the
//! layer the MCP bridge uses too), and the per-Reporter scope — so it is
//! unit-testable against an in-memory DB. The Tauri layer
//! (`packages/app/src-tauri/src/reporter.rs`) owns spawning, the stdio pump, and
//! frontend change events.
//!
//! Two channels: the committed channel (`card.*`, `deck.*`, `column.*`,
//! `card.stream.begin`/`end`) goes through `handle_message`; the ephemeral
//! `card.stream.delta` is recognized by `peek_ephemeral` and never touches the DB.

mod dispatch;
mod protocol;
mod scope;

pub use dispatch::{dispatch, Committed, DispatchOutcome};
pub use protocol::{RpcError, StreamDelta};
pub use jot_deck_core::access::{Capabilities, DEFAULT_MAX_WRITES_PER_MIN};
pub use scope::ReporterScope;

use jot_deck_core::Connection;
use serde_json::Value;

/// Peek at a raw line for an ephemeral `card.stream.delta` before it reaches the
/// DB path. Deltas never touch SQLite (007 §4 / §8.2), so the host recognizes
/// them here and pushes the chunk straight to the frontend overlay — no
/// connection lock, no dispatch. Returns `None` for any other method (which then
/// goes through `handle_message`). A delta may carry an `id` or not; either way
/// it is fire-and-forget and never answered.
pub fn peek_ephemeral(line: &str) -> Option<StreamDelta> {
    let msg: Value = serde_json::from_str(line).ok()?;
    if msg.get("method").and_then(Value::as_str)? != "card.stream.delta" {
        return None;
    }
    let params = msg.get("params")?;
    serde_json::from_value(params.clone()).ok()
}

/// The outcome of handling one line: the response to write back (every
/// committed-channel method is request/response), plus what the write changed so
/// the host can emit a frontend event.
pub struct Handled {
    /// Serialized JSON-RPC response line to write to the Reporter's stdin, or
    /// `None` for a notification (no `id`), which must not be answered.
    pub response: Option<String>,
    /// Set when the call committed a write (for the host's change event).
    pub committed: Option<Committed>,
}

/// Handle one incoming JSON-RPC line from a Reporter against `conn` under
/// `scope` (which Decks it may address is part of the scope). Mirrors `Bridge::handle_message`: parse the envelope, treat a
/// missing `id` as a notification (no reply), otherwise dispatch and build the
/// success/error response.
pub fn handle_message(conn: &Connection, scope: &ReporterScope, line: &str) -> Handled {
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

    match dispatch(conn, scope, method, &params) {
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

    /// A scope with every capability, limited to `deck_id` (so calls may omit
    /// it, like a Reporter registered for a single Deck).
    fn pinned(deck_id: &str, reporter_id: &str) -> ReporterScope {
        ReporterScope::new(
            Some(vec![deck_id.to_string()]),
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            reporter_id.to_string(),
        )
    }

    /// Send one request and return the parsed response Value plus the committed
    /// signal, using an all-enabled scope pinned to `deck_id`.
    fn call(
        conn: &Connection,
        deck_id: &str,
        method: &str,
        params: Value,
    ) -> (Value, Option<Committed>) {
        call_scoped(conn, &pinned(deck_id, "r1"), method, params)
    }

    fn call_scoped(
        conn: &Connection,
        scope: &ReporterScope,
        method: &str,
        params: Value,
    ) -> (Value, Option<Committed>) {
        let req = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
            .to_string();
        let handled = handle_message(conn, scope, &req);
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
    fn writes_are_recorded_under_the_reporter() {
        let (conn, _, col_id, _, _) = deck_with_data();
        // Unpinned: a card append addresses its Deck through the column.
        let scope = ReporterScope::default();
        let (resp, _) = call_scoped(
            &conn,
            &scope,
            "card.append",
            json!({ "column_id": col_id, "content": "note" }),
        );
        let card_id = resp["result"]["card_id"].as_str().unwrap();

        let rows = jot_deck_core::history::list_by_target(&conn, card_id).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].author, scope.author());
        assert_eq!(rows[0].author.id, scope.reporter_id);
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
            Some(vec![deck_id.clone()]),
            Capabilities::from_deny(["append"]).0,
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "r1".to_string(),
        );
        let (resp, committed) = call_scoped(
            &conn,
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
            Some(vec![deck_id.clone()]),
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            Some(vec![col_id.clone()]),
            "r1".to_string(),
        );
        // Append to an allowed column succeeds.
        let (ok, _) = call_scoped(
            &conn,
            &scope,
            "card.append",
            json!({ "column_id": col_id, "content": "in scope" }),
        );
        assert!(ok["result"]["card_id"].is_string());
        // Append to a made-up column id outside the allowlist is Unauthorized.
        let (bad, _) = call_scoped(
            &conn,
            &scope,
            "card.append",
            json!({ "column_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "content": "x" }),
        );
        assert_eq!(bad["error"]["code"], protocol::UNAUTHORIZED);
        // With an allowlist set, ensure_column may still *get* an existing column
        // but must not *create* a new one.
        let (created, _) = call_scoped(
            &conn,
            &scope,
            "column.ensure",
            json!({ "name": "Fresh", "description": "d" }),
        );
        assert!(created["error"].is_object());
    }

    #[test]
    fn move_card_reorders_and_signals_committed() {
        let (conn, deck_id, col_id, _, card_id) = deck_with_data();
        // Add a second card so there's an anchor to move before.
        let (appended, _) = call(
            &conn,
            &deck_id,
            "card.append",
            json!({ "column_id": col_id, "content": "second" }),
        );
        let second_id = appended["result"]["card_id"].as_str().unwrap().to_string();
        // Move the second card before the first.
        let (resp, committed) = call(
            &conn,
            &deck_id,
            "card.move",
            json!({ "card_id": second_id, "before_card_id": card_id }),
        );
        assert_eq!(resp["result"]["position"], 0);
        assert!(matches!(committed, Some(Committed::Card { .. })));
    }

    #[test]
    fn delete_card_soft_deletes_and_delete_capability_gates_it() {
        let (conn, deck_id, _col, _, card_id) = deck_with_data();
        // With `delete` denied, the call is refused.
        let denied = ReporterScope::new(
            Some(vec![deck_id.clone()]),
            Capabilities::from_deny(["delete"]).0,
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "r1".to_string(),
        );
        let (blocked, committed) = call_scoped(
            &conn,
            &denied,
            "card.delete",
            json!({ "card_id": card_id }),
        );
        assert_eq!(blocked["error"]["code"], protocol::POLICY_DENIED);
        assert!(committed.is_none());

        // Default scope (delete enabled) soft-deletes it.
        let (resp, committed) = call(&conn, &deck_id, "card.delete", json!({ "card_id": card_id }));
        assert_eq!(resp["result"]["card_id"], card_id);
        assert!(resp["result"]["deleted_at"].as_str().is_some_and(|s| !s.is_empty()));
        assert!(matches!(committed, Some(Committed::Card { .. })));
        // The card now reads back as gone (soft-deleted).
        let (read, _) = call(&conn, &deck_id, "card.read", json!({ "card_id": card_id }));
        assert_eq!(read["error"]["code"], protocol::NOT_FOUND);
    }

    #[test]
    fn move_card_outside_write_allowlist_is_unauthorized() {
        let (conn, deck_id, col_id, _, card_id) = deck_with_data();
        // Allowlist names only the visible column; moving to a made-up column id
        // outside it is rejected.
        let scope = ReporterScope::new(
            Some(vec![deck_id.clone()]),
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            Some(vec![col_id]),
            "r1".to_string(),
        );
        let (resp, _) = call_scoped(
            &conn,
            &scope,
            "card.move",
            json!({ "card_id": card_id, "to_column_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
        );
        assert_eq!(resp["error"]["code"], protocol::UNAUTHORIZED);
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
        let handled = handle_message(&conn, &pinned(&deck_id, "r1"), &req);
        assert!(handled.response.is_none());
    }

    // ---- stream lifecycle (007 §6.2) ----

    #[test]
    fn stream_begin_locks_and_end_commits() {
        let (conn, deck_id, _col, _, card_id) = deck_with_data();
        // One Reporter = one scope for its whole lifetime: begin and end must
        // present the same holder id, or end sees the lock as someone else's.
        let scope = ReporterScope::new(
            Some(vec![deck_id.clone()]),
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "reporter:1".to_string(),
        );
        let (begin, committed) = call_scoped(
            &conn,
            &scope,
            "card.stream.begin",
            json!({ "card_id": card_id }),
        );
        assert_eq!(begin["result"]["card_id"], card_id);
        assert!(matches!(committed, Some(Committed::StreamBegin { .. })));

        let (end, committed_end) = call_scoped(
            &conn,
            &scope,
            "card.stream.end",
            json!({ "card_id": card_id, "content": "final #done" }),
        );
        assert_eq!(end["result"]["card_id"], card_id);
        assert!(matches!(committed_end, Some(Committed::StreamEnd { .. })));

        // The committed text is now readable and the lock is cleared.
        let (read, _) = call(&conn, &deck_id, "card.read", json!({ "card_id": card_id }));
        assert_eq!(read["result"]["content"], "final #done");
        assert!(read["result"]["locked_by"].is_null());
    }

    #[test]
    fn stream_begin_conflicts_when_held_by_another_reporter() {
        let (conn, deck_id, _col, _, card_id) = deck_with_data();
        let scope_a = ReporterScope::new(
            Some(vec![deck_id.clone()]),
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "reporter:a".to_string(),
        );
        let scope_b = ReporterScope::new(
            Some(vec![deck_id.clone()]),
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "reporter:b".to_string(),
        );
        let (ok, _) = call_scoped(
            &conn,
            &scope_a,
            "card.stream.begin",
            json!({ "card_id": card_id }),
        );
        assert!(ok["result"]["card_id"].is_string());
        let (conflict, committed) = call_scoped(
            &conn,
            &scope_b,
            "card.stream.begin",
            json!({ "card_id": card_id }),
        );
        assert_eq!(conflict["error"]["code"], protocol::CONFLICT);
        assert!(committed.is_none());
    }

    #[test]
    fn stream_begin_denied_when_edit_capability_off() {
        let (conn, deck_id, _col, _, card_id) = deck_with_data();
        let scope = ReporterScope::new(
            Some(vec![deck_id.clone()]),
            Capabilities::from_deny(["edit"]).0,
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "r1".to_string(),
        );
        let (resp, _) = call_scoped(
            &conn,
            &scope,
            "card.stream.begin",
            json!({ "card_id": card_id }),
        );
        assert_eq!(resp["error"]["code"], protocol::POLICY_DENIED);
    }

    #[test]
    fn peek_ephemeral_extracts_delta_and_ignores_others() {
        let delta = json!({
            "jsonrpc": "2.0", "method": "card.stream.delta",
            "params": { "card_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "chunk": "hi" }
        })
        .to_string();
        let parsed = peek_ephemeral(&delta).expect("delta should parse");
        assert_eq!(parsed.card_id, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
        assert_eq!(parsed.chunk, "hi");

        // A committed-channel method is not ephemeral.
        let append = json!({
            "jsonrpc": "2.0", "id": 1, "method": "card.append",
            "params": { "column_id": "c", "content": "x" }
        })
        .to_string();
        assert!(peek_ephemeral(&append).is_none());
        // Garbage is not ephemeral.
        assert!(peek_ephemeral("not json").is_none());
    }

    /// A second Deck with one visible column, for the multi-Deck scope tests.
    fn second_deck(conn: &Connection) -> (String, String) {
        let d = deck::create(
            conn,
            NewDeck {
                name: "Work".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let col = column::create(
            conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Inbox".to_string(),
            },
        )
        .unwrap();
        (d.id, col.id)
    }

    #[test]
    fn describe_and_initialize_report_the_full_scope() {
        let (conn, deck_id, col_id, _, _) = deck_with_data();
        let scope = ReporterScope::new(
            Some(vec![deck_id.clone()]),
            Capabilities::default(),
            30,
            Some(vec![col_id.clone()]),
            "r1".to_string(),
        );
        let (desc, _) = call_scoped(&conn, &scope, "deck.describe", json!({}));
        let caps = &desc["result"]["capabilities"];
        assert_eq!(caps["write_columns"], json!([col_id]));
        assert_eq!(caps["pinned_deck_ids"], json!([deck_id]));
        assert_eq!(desc["result"]["constraints"]["max_writes_per_min"], 30);

        let (init, _) = call_scoped(&conn, &scope, "initialize", json!({}));
        assert_eq!(init["result"]["capabilities"], *caps);
    }

    #[test]
    fn deck_queries_return_the_same_shape_as_mcp() {
        let (conn, deck_id, _, _, _) = deck_with_data();
        for method in ["deck.list_columns", "deck.recent_cards", "deck.search_cards"] {
            let (resp, _) = call(&conn, &deck_id, method, json!({}));
            assert_eq!(resp["result"]["deck_id"], deck_id, "{method}");
        }
        let (decks, _) = call(&conn, &deck_id, "deck.list", json!({}));
        assert_eq!(decks["result"]["decks"][0]["deck_id"], deck_id);
    }

    #[test]
    fn multi_deck_scope_takes_deck_id_per_call_and_rejects_others() {
        let (conn, home, _, _, _) = deck_with_data();
        let (work, work_col) = second_deck(&conn);
        let (_, other_col) = second_deck(&conn);
        let both = ReporterScope::new(
            Some(vec![home.clone(), work.clone()]),
            Capabilities::default(),
            DEFAULT_MAX_WRITES_PER_MIN,
            None,
            "r1".to_string(),
        );

        // Several Decks: a Deck-level call must name one.
        let (missing, _) = call_scoped(&conn, &both, "deck.list_columns", json!({}));
        assert_eq!(missing["error"]["code"], protocol::INVALID_OPERATION);
        let (cols, _) = call_scoped(&conn, &both, "deck.list_columns", json!({ "deck_id": work }));
        assert_eq!(cols["result"]["deck_id"], work);

        // Card writes follow their column's Deck — inside the scope only.
        let (ok, committed) = call_scoped(
            &conn,
            &both,
            "card.append",
            json!({ "column_id": work_col, "content": "from work" }),
        );
        assert!(ok["result"]["card_id"].is_string());
        assert!(matches!(committed, Some(Committed::Card { column_id }) if column_id == work_col));
        let (outside, committed) = call_scoped(
            &conn,
            &both,
            "card.append",
            json!({ "column_id": other_col, "content": "elsewhere" }),
        );
        assert_eq!(outside["error"]["code"], protocol::UNAUTHORIZED);
        assert!(committed.is_none());

        let (listed, _) = call_scoped(&conn, &both, "deck.list", json!({}));
        assert_eq!(listed["result"]["decks"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn unpinned_scope_reaches_every_deck() {
        let (conn, home, _, _, _) = deck_with_data();
        let (work, _) = second_deck(&conn);
        let scope = ReporterScope::default();
        let (ensured, _) = call_scoped(
            &conn,
            &scope,
            "column.ensure",
            json!({ "deck_id": work, "name": "Minutes" }),
        );
        assert_eq!(ensured["result"]["deck_id"], work);
        assert_eq!(ensured["result"]["created"], true);
        let (listed, _) = call_scoped(&conn, &scope, "deck.list", json!({}));
        let ids: Vec<&str> = listed["result"]["decks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["deck_id"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&home.as_str()) && ids.contains(&work.as_str()));
    }
}
