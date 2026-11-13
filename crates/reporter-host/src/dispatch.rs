//! Method → core mapping for the Reporter committed channel (007 §6.1).
//!
//! `dispatch` takes a borrowed `Connection` (not an owned one like the MCP
//! bridge) because the host owns the shared GUI connection and lends it per
//! message — this also lets the unit tests drive dispatch against an in-memory
//! DB. Every method runs through `jot_deck_core::access`, the layer the MCP
//! bridge uses too: it resolves the target Deck, applies the Reporter's policy
//! (Deck scope, capability, rate limit, column allowlist) and shapes the result,
//! so a Reporter method and its MCP tool answer identically. This layer only
//! routes and turns a write's effect into a frontend change signal.

use jot_deck_core::access::{self, AccessError, AccessPolicy, Effect, Written};
use jot_deck_core::history::Author;
use jot_deck_core::{query, Connection};
use serde_json::{json, Value};

use crate::protocol::{RpcError, METHOD_NOT_FOUND};
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

impl From<Effect> for Committed {
    fn from(effect: Effect) -> Self {
        match effect {
            Effect::Card { column_id, .. } => Self::Card { column_id },
            Effect::Structure { .. } => Self::Structure,
            Effect::StreamBegin { card_id, column_id } => Self::StreamBegin { card_id, column_id },
            Effect::StreamEnd { card_id, column_id } => Self::StreamEnd { card_id, column_id },
        }
    }
}

/// The result of a dispatched method: the JSON result value plus, for writes,
/// what changed (the host turns this into a frontend change event).
pub struct DispatchOutcome {
    pub result: Value,
    pub committed: Option<Committed>,
}

impl DispatchOutcome {
    fn read(result: Result<Value, AccessError>) -> Result<Self, RpcError> {
        Ok(Self {
            result: result?,
            committed: None,
        })
    }

    fn wrote(written: Result<Written, AccessError>) -> Result<Self, RpcError> {
        let written = written?;
        Ok(Self {
            result: written.result,
            committed: Some(written.effect.into()),
        })
    }
}

/// Route one Reporter method to the shared access layer under `scope`.
///
/// Covers 007 §6.1's committed channel: `card.append`, `card.patch`
/// (alias `card.commit`), `card.move`, `card.delete`, `card.read`, the `deck.*`
/// queries, `column.ensure`/`update`/`move`, and the stream's `begin`/`end`.
/// Each maps onto the same `access` operation as its MCP tool (008 §4.1).
pub fn dispatch(
    conn: &Connection,
    scope: &ReporterScope,
    method: &str,
    params: &Value,
) -> Result<DispatchOutcome, RpcError> {
    let policy = scope.policy();
    let author = scope.author();
    let write = |op: fn(&Connection, &AccessPolicy, &Author, &Value) -> Result<Written, AccessError>| {
        DispatchOutcome::wrote(op(conn, policy, &author, params))
    };
    match method {
        // Handshake / liveness — no DB access, no write.
        "initialize" => DispatchOutcome::read(Ok(initialize(scope))),
        "ping" => DispatchOutcome::read(Ok(json!({}))),

        // ---- committed writes ----
        "card.append" => write(access::append_card),
        "card.patch" | "card.commit" => write(access::patch_card),
        "card.move" => write(access::move_card),
        "card.delete" => write(access::delete_card),
        "column.ensure" => write(access::ensure_column),
        "column.update" => write(access::update_column),
        "column.move" => write(access::move_column),

        // ---- stream lifecycle (007 §6.2). delta is ephemeral and handled by
        // peek_ephemeral before it reaches dispatch, so only begin/end land here.
        // The Reporter's id is the occupancy-lock holder. ----
        "card.stream.begin" => DispatchOutcome::wrote(access::begin_card_stream(
            conn,
            policy,
            &scope.reporter_id,
            params,
        )),
        "card.stream.end" => DispatchOutcome::wrote(access::end_card_stream(
            conn,
            policy,
            &scope.reporter_id,
            &author,
            params,
        )),

        // ---- reads ----
        "card.read" => DispatchOutcome::read(access::read_card(conn, policy, params)),
        "deck.list" => DispatchOutcome::read(access::list_decks(conn, policy)),
        "deck.list_columns" => DispatchOutcome::read(access::list_columns(conn, policy, params)),
        "deck.recent_cards" => DispatchOutcome::read(access::recent_cards(conn, policy, params)),
        "deck.search_cards" => DispatchOutcome::read(access::search_cards(conn, policy, params)),
        "deck.describe" => DispatchOutcome::read(access::describe_deck(conn, policy, params)),

        other => Err(RpcError::new(
            METHOD_NOT_FOUND,
            format!("Method not found: {}", other),
        )),
    }
}

/// Primer + this Reporter's effective policy, returned on `initialize` so a
/// Reporter learns its scope without the user configuring it out-of-band.
fn initialize(scope: &ReporterScope) -> Value {
    json!({
        "protocol": "jot-deck-reporter",
        "protocolVersion": "1",
        "serverInfo": { "name": "jot-deck-reporter-host", "version": env!("CARGO_PKG_VERSION") },
        "capabilities": scope.policy().capabilities_json(),
        "constraints": {
            "max_card_length": query::MAX_CARD_LENGTH,
            "max_writes_per_min": scope.max_writes_per_min(),
        },
    })
}
