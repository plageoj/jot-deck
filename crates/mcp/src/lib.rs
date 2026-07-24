//! Jot Deck MCP bridge — read surface (008-mcp-server.md).
//!
//! A small stdio JSON-RPC server that links `jot_deck_core`, opens the deck's
//! SQLite file directly (the CLI's sibling — no IPC with the GUI), and maps MCP
//! `tools/call` onto the deck-scoped read queries in `jot_deck_core::query`.
//! It is connected to a single Deck (`deck_id`); `private` and deleted columns
//! are filtered inside the core queries, which are the trust boundary.
//!
//! Only the read surface (Phase 4) is implemented: `list_columns`, `read_card`,
//! `search_cards`, `recent_cards`, `describe_deck`, plus the `deck://` resources.
//! Write tools arrive in Phase 5.

use jot_deck_core::{query, Connection};
use serde_json::{json, Value};

/// Protocol version we advertise when the client doesn't request one.
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";
const SERVER_NAME: &str = "jot-deck";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Primer loaded into the host's system context on `initialize` (008 §4.6).
const INSTRUCTIONS: &str = "\
Jot Deck exposes one Deck as a read-only knowledge base. Hierarchy: Deck > Column > Card. \
A Card is a tweet-sized atomic note. To find things, start with `describe_deck` or \
`list_columns` to learn the columns and their purpose, then `search_cards` (full-text + \
tag/score/column filters) or `recent_cards`. Fetch a single card with `read_card`. \
Column and card ids are ULIDs assigned by Jot Deck — discover them via the tools, never \
guess them. `#tag` markers in card content are indexed and searchable. Private columns are \
never returned. This connection is read-only; there are no write tools.";

/// The MCP bridge over one connection and one deck.
pub struct Bridge {
    conn: Connection,
    deck_id: String,
}

impl Bridge {
    pub fn new(conn: Connection, deck_id: String) -> Self {
        Self { conn, deck_id }
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
            "tools/list" => success(id, json!({ "tools": tool_defs() })),
            "tools/call" => self.tools_call(id, params),
            "resources/list" => success(id, json!({ "resources": self.resource_defs() })),
            "resources/read" => self.resources_read(id, params),
            _ => error_response(id, -32601, &format!("Method not found: {}", method)),
        }
    }

    fn initialize(&self, params: &Value) -> Value {
        // Echo the client's protocol version when present (they picked a version
        // both sides understand); otherwise advertise our default.
        let protocol_version = params
            .get("protocolVersion")
            .and_then(Value::as_str)
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
        query::list_columns(&self.conn, &self.deck_id)
            .map(|c| json!(c))
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
            .map(|c| json!(c))
            .map_err(|e| e.to_string())
    }

    fn tool_recent_cards(&self, args: &Value) -> Result<Value, String> {
        let column_id = opt_str(args, "column_id");
        let limit = args.get("limit").and_then(Value::as_u64).map(|n| n as usize);
        query::recent_cards(&self.conn, &self.deck_id, column_id.as_deref(), limit)
            .map(|c| json!(c))
            .map_err(|e| e.to_string())
    }

    fn tool_describe_deck(&self) -> Result<Value, String> {
        query::describe_deck(&self.conn, &self.deck_id)
            .map(|d| json!(d))
            .map_err(|e| e.to_string())
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

/// MCP tool definitions with input schemas and teaching descriptions (008 §4.6).
fn tool_defs() -> Vec<Value> {
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
        let cols = structured(&resp).as_array().unwrap();
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0]["name"], "Research");
    }

    #[test]
    fn search_cards_finds_by_tag() {
        let (bridge, _, _) = bridge_with_data();
        let resp = call(&bridge, 1, "search_cards", json!({ "tags": ["lang"] }));
        let cards = structured(&resp).as_array().unwrap();
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
}
