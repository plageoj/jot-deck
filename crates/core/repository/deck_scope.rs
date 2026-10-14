//! Which Deck an MCP call addresses (008-mcp-server.md §4.5).
//!
//! A connection is either pinned to one Deck (`JOT_DECK_DECK_ID`) or may address
//! any local Deck per call. Deck-addressed tools resolve their target with
//! [`DeckScope::resolve`] (pinned → explicit `deck_id` → the GUI's last active
//! Deck in the shared `settings` table → error); card/column-addressed tools
//! derive it from the id they name. Like `query.rs`/`write.rs`, this validation
//! lives in core — the bridge is untrusted (008 §4.5).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{JotDeckError, Result};
use crate::repository::{deck, setting};

/// `list_decks` の 1 行。
#[derive(Debug, Clone, Serialize)]
pub struct DeckSummary {
    pub deck_id: String,
    pub name: String,
    /// GUI の直近アクティブ Deck（`deck_id` 省略時の既定値）かどうか。
    pub active: bool,
}

/// 接続が扱える Deck の範囲。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeckScope {
    /// `JOT_DECK_DECK_ID` で 1 Deck に厳格固定。他 Deck の指定は Unauthorized。
    Pinned(String),
    /// ローカルの全 Deck。対象は呼び出しごとに `deck_id` で決まる。
    AnyDeck,
}

impl DeckScope {
    /// 空文字列は未設定扱い（AnyDeck）。
    pub fn from_pinned(pinned: Option<String>) -> Self {
        match pinned.filter(|id| !id.is_empty()) {
            Some(id) => Self::Pinned(id),
            None => Self::AnyDeck,
        }
    }

    pub fn pinned(&self) -> Option<&str> {
        match self {
            Self::Pinned(id) => Some(id),
            Self::AnyDeck => None,
        }
    }

    /// Deck を引数に取る tool の対象 Deck を決める（008 §4.5 の解決順）。
    ///
    /// 1. 固定接続ならその Deck（別の `deck_id` 明示は Unauthorized）
    /// 2. 呼び出しが明示した `deck_id`
    /// 3. 共有 `settings` の GUI 直近アクティブ Deck
    /// 4. いずれも無ければ InvalidOperation（`list_decks` で選ばせる）
    pub fn resolve(&self, conn: &Connection, requested: Option<&str>) -> Result<String> {
        let requested = requested.filter(|id| !id.is_empty());
        if let Self::Pinned(pinned) = self {
            if let Some(req) = requested {
                if req != pinned {
                    return Err(JotDeckError::Unauthorized(format!(
                        "Deck {} is outside this connection, which is pinned to Deck {} (JOT_DECK_DECK_ID). Omit deck_id.",
                        req, pinned
                    )));
                }
            }
            return Ok(deck::get_by_id(conn, pinned)?.id);
        }
        if let Some(req) = requested {
            return Ok(deck::get_by_id(conn, req)?.id);
        }
        if let Some(active) = setting::get_active_deck_id(conn)? {
            // A recorded Deck that has since been deleted is not a usable default.
            if deck_exists(conn, &active)? {
                return Ok(active);
            }
        }
        Err(JotDeckError::InvalidOperation(
            "deck_id required: no deck_id was given and the Jot Deck app has no active Deck recorded. Call list_decks and pass a deck_id."
                .to_string(),
        ))
    }

    /// カードを ID で指す tool の対象 Deck。固定接続では固定 Deck（他 Deck の
    /// カードは下流のクエリが NotFound にする）、それ以外はカードの所属 Deck。
    /// 可視性（private / 削除）は下流のクエリ/書き込みが判定する。
    pub fn deck_for_card(&self, conn: &Connection, card_id: &str) -> Result<String> {
        if let Self::Pinned(pinned) = self {
            return Ok(pinned.clone());
        }
        conn.query_row(
            "SELECT col.deck_id FROM cards c JOIN columns col ON c.column_id = col.id WHERE c.id = ?1",
            params![card_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| JotDeckError::NotFound(format!("Card not found: {}", card_id)))
    }

    /// カラムを ID で指す tool の対象 Deck（`deck_for_card` のカラム版）。
    pub fn deck_for_column(&self, conn: &Connection, column_id: &str) -> Result<String> {
        if let Self::Pinned(pinned) = self {
            return Ok(pinned.clone());
        }
        conn.query_row(
            "SELECT deck_id FROM columns WHERE id = ?1",
            params![column_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| JotDeckError::Unauthorized(format!("Column not accessible: {}", column_id)))
    }

    /// この接続が扱える Deck の一覧（`list_decks`）。固定接続ではその 1 件のみ。
    /// Deck 単位の可視性除外は無い（private はカラム単位のみ → 008 §4.5）。
    pub fn list_decks(&self, conn: &Connection) -> Result<Vec<DeckSummary>> {
        let active = setting::get_active_deck_id(conn)?;
        let decks = match self {
            Self::Pinned(pinned) => vec![deck::get_by_id(conn, pinned)?],
            Self::AnyDeck => deck::get_all(conn)?,
        };
        Ok(decks
            .into_iter()
            .map(|d| DeckSummary {
                active: active.as_deref() == Some(d.id.as_str()),
                deck_id: d.id,
                name: d.name,
            })
            .collect())
    }
}

fn deck_exists(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM decks WHERE id = ?1", params![id], |_| Ok(()))
        .optional()?
        .is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewCard, NewColumn, NewDeck, SortOrder};
    use crate::repository::{card, column};

    fn new_deck(conn: &Connection, name: &str) -> String {
        deck::create(
            conn,
            NewDeck {
                name: name.to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn from_pinned_treats_empty_as_any_deck() {
        assert_eq!(DeckScope::from_pinned(None), DeckScope::AnyDeck);
        assert_eq!(DeckScope::from_pinned(Some(String::new())), DeckScope::AnyDeck);
        assert_eq!(
            DeckScope::from_pinned(Some("D".to_string())),
            DeckScope::Pinned("D".to_string())
        );
    }

    #[test]
    fn pinned_uses_pinned_deck_and_rejects_others() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
        let scope = DeckScope::Pinned(a.clone());
        assert_eq!(scope.resolve(&conn, None).unwrap(), a);
        assert_eq!(scope.resolve(&conn, Some(&a)).unwrap(), a);
        assert!(matches!(
            scope.resolve(&conn, Some(&b)),
            Err(JotDeckError::Unauthorized(_))
        ));
    }

    #[test]
    fn any_deck_prefers_explicit_then_active_then_errors() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
        let scope = DeckScope::AnyDeck;

        assert!(matches!(
            scope.resolve(&conn, None),
            Err(JotDeckError::InvalidOperation(_))
        ));

        setting::set_active_deck_id(&conn, &a).unwrap();
        assert_eq!(scope.resolve(&conn, None).unwrap(), a);
        assert_eq!(scope.resolve(&conn, Some(&b)).unwrap(), b);
        assert!(matches!(
            scope.resolve(&conn, Some("missing")),
            Err(JotDeckError::NotFound(_))
        ));
    }

    #[test]
    fn stale_active_deck_is_not_a_default() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        setting::set_active_deck_id(&conn, &a).unwrap();
        deck::delete(&conn, &a).unwrap();
        assert!(matches!(
            DeckScope::AnyDeck.resolve(&conn, None),
            Err(JotDeckError::InvalidOperation(_))
        ));
    }

    #[test]
    fn deck_for_card_and_column_follow_ownership() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let col = column::create(
            &conn,
            NewColumn {
                deck_id: a.clone(),
                name: "C".to_string(),
            },
        )
        .unwrap();
        let c = card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "x".to_string(),
            },
        )
        .unwrap();

        let any = DeckScope::AnyDeck;
        assert_eq!(any.deck_for_card(&conn, &c.id).unwrap(), a);
        assert_eq!(any.deck_for_column(&conn, &col.id).unwrap(), a);
        assert!(matches!(
            any.deck_for_card(&conn, "missing"),
            Err(JotDeckError::NotFound(_))
        ));
        assert!(matches!(
            any.deck_for_column(&conn, "missing"),
            Err(JotDeckError::Unauthorized(_))
        ));

        // A pinned scope never looks elsewhere: downstream queries reject ids
        // outside the pinned Deck.
        let pinned = DeckScope::Pinned("other".to_string());
        assert_eq!(pinned.deck_for_card(&conn, &c.id).unwrap(), "other");
    }

    #[test]
    fn list_decks_marks_active_and_respects_pin() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
        setting::set_active_deck_id(&conn, &b).unwrap();

        let all = DeckScope::AnyDeck.list_decks(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|d| d.deck_id == b && d.active));
        assert!(all.iter().any(|d| d.deck_id == a && !d.active));

        let pinned = DeckScope::Pinned(a.clone()).list_decks(&conn).unwrap();
        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].deck_id, a);
        assert!(!pinned[0].active);
    }
}
