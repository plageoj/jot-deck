//! Method → core mapping for the Reporter committed channel (007 §6.1).
//!
//! `dispatch` takes a borrowed `Connection` (not an owned one like the MCP
//! bridge) because the host owns the shared GUI connection and lends it per
//! message — this also lets the unit tests drive dispatch against an in-memory
//! DB, exactly as `write.rs`'s own tests do. Numbering, tag extraction, `private`
//! exclusion, the card-length backstop and idempotency all stay in
//! `jot_deck_core::write`/`query`; this layer only routes, applies the Reporter
//! scope (capability/rate-limit/allowlist), and shapes results.

use chrono::Utc;
use jot_deck_core::{query, write, Connection};
use serde_json::{json, Value};

use crate::protocol::{
    parse_params, AppendParams, DeleteParams, EnsureColumnParams, MoveCardParams, MoveColumnParams,
    PatchParams, ReadParams, RecentCardsParams, RpcError, SearchCardsParams, StreamBeginParams,
    StreamEndParams, UpdateColumnParams, METHOD_NOT_FOUND,
};
use crate::scope::ReporterScope;

/// What a successful call changed, so the host can notify the frontend. Reads
/// carry `None`.
pub enum Committed {
    /// A card was written into this column — the frontend can reload just it.
    Card { column_id: String },
    /// Columns changed structurally (ensure/update/move) — reload the column set.
    Structure,
    /// A stream opened on a card — the frontend shows it as AI-generating and
    /// blocks editing (007 §7).
    StreamBegin {
        card_id: String,
        column_id: String,
    },
    /// A stream committed on a card — the frontend reloads it and drops the
    /// overlay.
    StreamEnd {
        card_id: String,
        column_id: String,
    },
}

/// The result of a dispatched method: the JSON result value plus, for writes,
/// what changed (the host turns this into a frontend change event).
pub struct DispatchOutcome {
    pub result: Value,
    pub committed: Option<Committed>,
}

impl DispatchOutcome {
    fn read(result: Value) -> Self {
        Self {
            result,
            committed: None,
        }
    }

    fn wrote(result: Value, committed: Committed) -> Self {
        Self {
            result,
            committed: Some(committed),
        }
    }
}

/// Route one Reporter method to the core write/query surface under `scope`.
///
/// Covers 007 §6.1's committed channel: `card.append`, `card.patch`
/// (alias `card.commit`), `card.move`, `card.delete`, `card.read`, the `deck.*`
/// queries (the concretized `deck.query`), and `column.ensure`/`update`/`move`.
/// (`card.move` / `card.delete` are the same core ops the general-agent MCP
/// surface exposes — 008 §4.1 — reused here so a Reporter can re-file and remove
/// cards, not only append.)
pub fn dispatch(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    method: &str,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    match method {
        // Handshake / liveness — no DB access, no write.
        "initialize" => Ok(DispatchOutcome::read(initialize(scope))),
        "ping" => Ok(DispatchOutcome::read(json!({}))),

        // ---- committed writes ----
        "card.append" => card_append(conn, deck_id, scope, params),
        "card.patch" | "card.commit" => card_patch(conn, deck_id, scope, params),
        "card.move" => card_move(conn, deck_id, scope, params),
        "card.delete" => card_delete(conn, deck_id, scope, params),
        "column.ensure" => column_ensure(conn, deck_id, scope, params),
        "column.update" => column_update(conn, deck_id, scope, params),
        "column.move" => column_move(conn, deck_id, scope, params),

        // ---- stream lifecycle (007 §6.2). delta is ephemeral and handled by
        // peek_ephemeral before it reaches dispatch, so only begin/end land here. ----
        "card.stream.begin" => card_stream_begin(conn, deck_id, scope, params),
        "card.stream.end" => card_stream_end(conn, deck_id, scope, params),

        // ---- reads (deck.query, concretized) ----
        "card.read" => card_read(conn, deck_id, params),
        "deck.list_columns" => deck_list_columns(conn, deck_id),
        "deck.recent_cards" => deck_recent_cards(conn, deck_id, params),
        "deck.search_cards" => deck_search_cards(conn, deck_id, params),
        "deck.describe" => deck_describe(conn, deck_id, scope),

        other => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("Method not found: {}", other),
        )),
    }
}

/// Primer + this Reporter's effective policy, returned on `initialize` so a
/// Reporter learns its scope without the user configuring it out-of-band.
fn initialize(scope: &ReporterScope) -> Value {
    let caps = scope.capabilities();
    json!({
        "protocol": "jot-deck-reporter",
        "protocolVersion": "1",
        "serverInfo": { "name": "jot-deck-reporter-host", "version": env!("CARGO_PKG_VERSION") },
        "capabilities": {
            "append": caps.append,
            "edit": caps.edit,
            "delete": caps.delete,
            "structure": caps.structure,
        },
        "constraints": {
            "max_card_length": query::MAX_CARD_LENGTH,
            "max_writes_per_min": scope.max_writes_per_min(),
        },
    })
}

// ---- writes ----

fn card_append(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    scope.begin_write(scope.capabilities().append, "append")?;
    let p: AppendParams = parse_params(params)?;
    scope.ensure_column_allowed(&p.column_id)?;
    let card = write::append_card(
        conn,
        deck_id,
        &p.column_id,
        &p.content,
        p.idempotency_key.as_deref(),
    )?;
    Ok(DispatchOutcome::wrote(
        json!({
            "card_id": card.id,
            "column_id": card.column_id,
            "position": card.position,
            "created_at": card.created_at.to_rfc3339(),
        }),
        Committed::Card {
            column_id: card.column_id,
        },
    ))
}

fn card_patch(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    scope.begin_write(scope.capabilities().edit, "edit")?;
    let p: PatchParams = parse_params(params)?;
    let expected_updated_at = chrono::DateTime::parse_from_rfc3339(&p.expected_updated_at)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| {
            RpcError::invalid_params(
                "expected_updated_at must be an RFC3339 timestamp (the updated_at you last read)",
            )
        })?;
    // Resolve the card's column through the visibility-enforced read so the
    // allowlist can be checked against it (read_card hides private/other-deck
    // as NotFound, so this never leaks an out-of-scope card's existence).
    let existing = query::read_card(conn, deck_id, &p.card_id)?;
    scope.ensure_column_allowed(&existing.column_id)?;
    let card = write::patch_card(conn, deck_id, &p.card_id, &p.content, expected_updated_at)?;
    Ok(DispatchOutcome::wrote(
        json!({ "card_id": card.id, "updated_at": card.updated_at.to_rfc3339() }),
        Committed::Card {
            column_id: card.column_id,
        },
    ))
}

fn card_move(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    // Moving an existing card is an edit of its placement (008 §5 gates move
    // under `edit`).
    scope.begin_write(scope.capabilities().edit, "edit")?;
    let p: MoveCardParams = parse_params(params)?;
    // Both the source column (the card's current column) and the destination
    // must be within the write allowlist — a move writes to both sides.
    let existing = query::read_card(conn, deck_id, &p.card_id)?;
    scope.ensure_column_allowed(&existing.column_id)?;
    if let Some(dest) = p.to_column_id.as_deref() {
        scope.ensure_column_allowed(dest)?;
    }
    let card = write::move_card(
        conn,
        deck_id,
        &p.card_id,
        p.to_column_id.as_deref(),
        p.before_card_id.as_deref(),
        p.after_card_id.as_deref(),
    )?;
    Ok(DispatchOutcome::wrote(
        json!({
            "card_id": card.id,
            "column_id": card.column_id,
            "position": card.position,
        }),
        Committed::Card {
            column_id: card.column_id,
        },
    ))
}

fn card_delete(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    scope.begin_write(scope.capabilities().delete, "delete")?;
    let p: DeleteParams = parse_params(params)?;
    let existing = query::read_card(conn, deck_id, &p.card_id)?;
    scope.ensure_column_allowed(&existing.column_id)?;
    let card = write::delete_card(conn, deck_id, &p.card_id)?;
    let deleted_at = card.deleted_at.map(|d| d.to_rfc3339()).unwrap_or_default();
    Ok(DispatchOutcome::wrote(
        json!({ "card_id": card.id, "deleted_at": deleted_at }),
        Committed::Card {
            column_id: card.column_id,
        },
    ))
}

fn card_stream_begin(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    // A stream is a form of edit — gate it under the `edit` capability.
    scope.begin_write(scope.capabilities().edit, "edit")?;
    let p: StreamBeginParams = parse_params(params)?;
    // Resolve the card's column for the allowlist check (read_card hides
    // out-of-scope cards as NotFound, same as card.patch).
    let existing = query::read_card(conn, deck_id, &p.card_id)?;
    scope.ensure_column_allowed(&existing.column_id)?;
    let card = write::begin_card_stream(conn, deck_id, &p.card_id, &scope.reporter_id)?;
    Ok(DispatchOutcome::wrote(
        json!({
            "card_id": card.id,
            "column_id": card.column_id,
            "locked_by": card.locked_by,
        }),
        Committed::StreamBegin {
            card_id: card.id.clone(),
            column_id: card.column_id,
        },
    ))
}

fn card_stream_end(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    scope.begin_write(scope.capabilities().edit, "edit")?;
    let p: StreamEndParams = parse_params(params)?;
    let existing = query::read_card(conn, deck_id, &p.card_id)?;
    scope.ensure_column_allowed(&existing.column_id)?;
    let card = write::end_card_stream(conn, deck_id, &p.card_id, &scope.reporter_id, &p.content)?;
    Ok(DispatchOutcome::wrote(
        json!({ "card_id": card.id, "updated_at": card.updated_at.to_rfc3339() }),
        Committed::StreamEnd {
            card_id: card.id.clone(),
            column_id: card.column_id,
        },
    ))
}

fn column_ensure(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    scope.begin_write(scope.capabilities().structure, "structure")?;
    let p: EnsureColumnParams = parse_params(params)?;
    // Getting an existing column is always allowed; only *creation* is gated by
    // structure + no-allowlist (008 §4.5). `write::ensure_column` returns the
    // gating error itself when create is needed but not permitted.
    let result = write::ensure_column(
        conn,
        deck_id,
        &p.name,
        &p.description,
        p.private,
        scope.allow_create(),
    )?;
    Ok(DispatchOutcome::wrote(
        json!({
            "column_id": result.column.id,
            "name": result.column.name,
            "position": result.column.position,
            "created": result.created,
        }),
        Committed::Structure,
    ))
}

fn column_update(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    scope.begin_write(scope.capabilities().structure, "structure")?;
    let p: UpdateColumnParams = parse_params(params)?;
    scope.ensure_column_allowed(&p.column_id)?;
    // description: Option<Option<String>> → Option<Option<&str>>, where the
    // inner empty string means "clear to NULL" (matches the MCP update_column).
    let description = p
        .description
        .as_ref()
        .map(|inner| inner.as_deref().filter(|s| !s.is_empty()));
    let column = write::update_column(
        conn,
        deck_id,
        &p.column_id,
        p.name.as_deref(),
        description,
        p.private,
    )?;
    Ok(DispatchOutcome::wrote(
        json!({
            "column_id": column.id,
            "name": column.name,
            "description": column.description,
            "private": column.private,
        }),
        Committed::Structure,
    ))
}

fn column_move(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    scope.begin_write(scope.capabilities().structure, "structure")?;
    let p: MoveColumnParams = parse_params(params)?;
    scope.ensure_column_allowed(&p.column_id)?;
    let column = write::move_column(
        conn,
        deck_id,
        &p.column_id,
        p.before_column_id.as_deref(),
        p.after_column_id.as_deref(),
    )?;
    Ok(DispatchOutcome::wrote(
        json!({ "column_id": column.id, "position": column.position }),
        Committed::Structure,
    ))
}

// ---- reads ----

fn card_read(
    conn: &Connection,
    deck_id: &str,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    let p: ReadParams = parse_params(params)?;
    let card = query::read_card(conn, deck_id, &p.card_id)?;
    Ok(DispatchOutcome::read(json!(card)))
}

fn deck_list_columns(conn: &Connection, deck_id: &str) -> Result<DispatchOutcome, RpcError> {
    let columns = query::list_columns(conn, deck_id)?;
    Ok(DispatchOutcome::read(json!({ "columns": columns })))
}

fn deck_recent_cards(
    conn: &Connection,
    deck_id: &str,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    let p: RecentCardsParams = parse_params(params)?;
    let cards = query::recent_cards(conn, deck_id, p.column_id.as_deref(), p.limit)?;
    Ok(DispatchOutcome::read(json!({ "cards": cards })))
}

fn deck_search_cards(
    conn: &Connection,
    deck_id: &str,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    let p: SearchCardsParams = parse_params(params)?;
    let search = query::SearchParams {
        query: p.query,
        column_id: p.column_id,
        tags: p.tags,
        min_score: p.min_score,
        limit: p.limit,
    };
    let cards = query::search_cards(conn, deck_id, &search)?;
    Ok(DispatchOutcome::read(json!({ "cards": cards })))
}

fn deck_describe(
    conn: &Connection,
    deck_id: &str,
    scope: &ReporterScope,
) -> Result<DispatchOutcome, RpcError> {
    let desc = query::describe_deck(conn, deck_id)?;
    let mut v = json!(desc);
    let caps = scope.capabilities();
    // Augment with this Reporter's effective policy, matching describe_deck on
    // the MCP side so a Reporter can read back its own scope (008 §4.6).
    v["capabilities"] = json!({
        "read": true,
        "append": caps.append,
        "edit": caps.edit,
        "delete": caps.delete,
        "structure": caps.structure,
    });
    if let Some(obj) = v.get_mut("constraints").and_then(Value::as_object_mut) {
        obj.insert(
            "max_writes_per_min".to_string(),
            json!(scope.max_writes_per_min()),
        );
    }
    Ok(DispatchOutcome::read(v))
}
