//! Which Deck an agent call addresses (008-mcp-server.md §4.5, 007 §2.3).
//!
//! A connection (an MCP bridge, or a running Reporter) is either pinned to a
//! list of Decks (`JOT_DECK_DECK_ID` / a Reporter registration's `deck_ids`) or
//! may address any local Deck per call. Deck-addressed
//! tools resolve their target with [`DeckScope::resolve`] (explicit `deck_id`,
//! checked against a pinned connection's list → the sole pinned Deck → error —
//! there is no implicit default, so a call's target never depends on GUI state);
//! card/column-addressed tools derive it from the id they name. The GUI's last
//! active Deck is only surfaced as a hint (`DeckSummary::active`). Like
//! `query.rs`/`write.rs`, this validation lives in core — the transports are
//! untrusted (008 §4.5).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{JotDeckError, Result};
use crate::repository::{deck, setting};

/// `list_decks` の 1 行。
#[derive(Debug, Clone, Serialize)]
pub struct DeckSummary {
    pub deck_id: String,
    pub name: String,
    /// GUI の直近アクティブ Deck かどうか。既定値ではなく、エージェントが
    /// 「今開いている Deck」を解釈するためのヒント。
    pub active: bool,
}

/// 接続が扱える Deck の範囲。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeckScope {
    /// 列挙した Deck（`JOT_DECK_DECK_ID` / Reporter の `deck_ids`。重複なし）に厳格限定。
    /// 列挙外の Deck の指定は Unauthorized、そのカード/カラムは見えない。
    Pinned(Vec<String>),
    /// ローカルの全 Deck。対象は呼び出しごとに `deck_id` で決まる。
    AnyDeck,
}

impl DeckScope {
    /// `JOT_DECK_DECK_ID` の生値（カンマ区切り）から作る。空要素は無視し、
    /// 重複は除く。有効な id が 1 つも無ければ未設定扱い（AnyDeck）。
    pub fn from_pinned(pinned: Option<String>) -> Self {
        let mut ids: Vec<String> = Vec::new();
        for id in pinned.as_deref().unwrap_or("").split(',').map(str::trim) {
            if !id.is_empty() && !ids.iter().any(|seen| seen == id) {
                ids.push(id.to_string());
            }
        }
        if ids.is_empty() {
            Self::AnyDeck
        } else {
            Self::Pinned(ids)
        }
    }

    /// 保存済みの Deck id 一覧から作る（Reporter 登録の `deck_ids`）。`None` は
    /// 全 Deck。空要素・重複は除く。`Some` で有効な id が残らなければ、どの Deck
    /// も扱えない接続になる（未設定扱いで全 Deck に広げない ―― fail-closed）。
    pub fn from_ids(ids: Option<&[String]>) -> Self {
        let Some(ids) = ids else {
            return Self::AnyDeck;
        };
        let mut pinned: Vec<String> = Vec::new();
        for id in ids.iter().map(|id| id.trim()) {
            if !id.is_empty() && !pinned.iter().any(|seen| seen == id) {
                pinned.push(id.to_string());
            }
        }
        Self::Pinned(pinned)
    }

    /// 列挙した Deck（固定接続のみ）。
    pub fn pinned(&self) -> Option<&[String]> {
        match self {
            Self::Pinned(ids) => Some(ids),
            Self::AnyDeck => None,
        }
    }

    /// 1 Deck だけに固定された接続ならその Deck（`deck_id` を省略できる接続）。
    pub fn sole_pinned(&self) -> Option<&str> {
        match self.pinned() {
            Some([only]) => Some(only),
            _ => None,
        }
    }

    /// この接続が `deck_id` の Deck を扱えるか（存在確認はしない）。
    fn admits(&self, deck_id: &str) -> bool {
        self.pinned()
            .is_none_or(|ids| ids.iter().any(|id| id == deck_id))
    }

    /// Deck を引数に取る tool の対象 Deck を決める（008 §4.5 の解決順）。
    ///
    /// 1. 呼び出しが明示した `deck_id`（固定接続では列挙外なら Unauthorized）
    /// 2. 省略時、1 Deck だけに固定された接続ならその Deck
    /// 3. いずれも無ければ InvalidOperation（`list_decks` で選ばせる）
    pub fn resolve(&self, conn: &Connection, requested: Option<&str>) -> Result<String> {
        let requested = requested.filter(|id| !id.is_empty());
        match (requested, self.sole_pinned()) {
            (Some(req), _) if !self.admits(req) => Err(JotDeckError::Unauthorized(format!(
                "Deck {} is outside this connection, which is limited to Deck(s) {}. List the Decks you can use (list_decks / deck.list).",
                req,
                self.pinned().unwrap_or_default().join(", ")
            ))),
            (Some(req), _) => Ok(deck::get_by_id(conn, req)?.id),
            (None, Some(only)) => Ok(deck::get_by_id(conn, only)?.id),
            (None, None) => Err(JotDeckError::InvalidOperation(
                "deck_id required: list the Decks (list_decks / deck.list) and pass a deck_id (the `active` Deck is the one last open in the Jot Deck app)."
                    .to_string(),
            )),
        }
    }

    /// カードを ID で指す tool の対象 Deck（カードの所属 Deck）。固定接続で
    /// 列挙外の Deck のカードは存在しないものとして NotFound（存在を漏らさない）。
    /// 可視性（private / 削除）は下流のクエリ/書き込みが判定する。
    pub fn deck_for_card(&self, conn: &Connection, card_id: &str) -> Result<String> {
        conn.query_row(
            "SELECT col.deck_id FROM cards c JOIN columns col ON c.column_id = col.id WHERE c.id = ?1",
            params![card_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .filter(|deck_id| self.admits(deck_id))
        .ok_or_else(|| JotDeckError::NotFound(format!("Card not found: {}", card_id)))
    }

    /// カラムを ID で指す tool の対象 Deck（`deck_for_card` のカラム版。
    /// 不在・列挙外とも Unauthorized）。
    pub fn deck_for_column(&self, conn: &Connection, column_id: &str) -> Result<String> {
        conn.query_row(
            "SELECT deck_id FROM columns WHERE id = ?1",
            params![column_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .filter(|deck_id| self.admits(deck_id))
        .ok_or_else(|| JotDeckError::Unauthorized(format!("Column not accessible: {}", column_id)))
    }

    /// この接続が扱える Deck の一覧（`list_decks`）。固定接続では列挙した Deck
    /// のみ（列挙順）。Deck 単位の除外は列挙だけで、private はカラム単位
    /// （008 §4.5）。列挙に残った削除済み Deck の id は飛ばす ―― 1 つの古い id
    /// のせいで残りの Deck が見えなくならないように。
    pub fn list_decks(&self, conn: &Connection) -> Result<Vec<DeckSummary>> {
        let active = setting::get_active_deck_id(conn)?;
        let decks = match self {
            Self::Pinned(ids) => {
                let mut decks = Vec::with_capacity(ids.len());
                for id in ids {
                    match deck::get_by_id(conn, id) {
                        Ok(d) => decks.push(d),
                        Err(JotDeckError::NotFound(_)) => {}
                        Err(e) => return Err(e),
                    }
                }
                decks
            }
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

    fn pinned(ids: &[&str]) -> DeckScope {
        DeckScope::Pinned(ids.iter().map(|id| id.to_string()).collect())
    }

    #[test]
    fn from_pinned_parses_a_comma_list() {
        assert_eq!(DeckScope::from_pinned(None), DeckScope::AnyDeck);
        assert_eq!(DeckScope::from_pinned(Some(String::new())), DeckScope::AnyDeck);
        assert_eq!(DeckScope::from_pinned(Some(" , ,".to_string())), DeckScope::AnyDeck);
        assert_eq!(DeckScope::from_pinned(Some("D".to_string())), pinned(&["D"]));
        assert_eq!(
            DeckScope::from_pinned(Some(" B, A ,,B".to_string())),
            pinned(&["B", "A"])
        );
    }

    #[test]
    fn from_ids_pins_the_listed_decks_and_fails_closed_when_empty() {
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(DeckScope::from_ids(None), DeckScope::AnyDeck);
        assert_eq!(
            DeckScope::from_ids(Some(&ids(&["B", " A", "B", ""]))),
            pinned(&["B", "A"])
        );
        // An empty list admits no Deck — it never widens to AnyDeck.
        let none = DeckScope::from_ids(Some(&ids(&[" "])));
        assert_eq!(none, pinned(&[]));
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        assert!(matches!(
            none.resolve(&conn, Some(&a)),
            Err(JotDeckError::Unauthorized(_))
        ));
        assert!(none.list_decks(&conn).unwrap().is_empty());
    }

    #[test]
    fn sole_pinned_only_for_a_single_deck() {
        assert_eq!(DeckScope::AnyDeck.sole_pinned(), None);
        assert_eq!(pinned(&["A"]).sole_pinned(), Some("A"));
        assert_eq!(pinned(&["A", "B"]).sole_pinned(), None);
    }

    #[test]
    fn single_pin_uses_pinned_deck_and_rejects_others() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
        let scope = pinned(&[&a]);
        assert_eq!(scope.resolve(&conn, None).unwrap(), a);
        assert_eq!(scope.resolve(&conn, Some(&a)).unwrap(), a);
        assert!(matches!(
            scope.resolve(&conn, Some(&b)),
            Err(JotDeckError::Unauthorized(_))
        ));
    }

    #[test]
    fn multi_pin_requires_a_listed_deck_id() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
        let c = new_deck(&conn, "C");
        let scope = pinned(&[&a, &b]);
        assert_eq!(scope.resolve(&conn, Some(&a)).unwrap(), a);
        assert_eq!(scope.resolve(&conn, Some(&b)).unwrap(), b);
        assert!(matches!(
            scope.resolve(&conn, Some(&c)),
            Err(JotDeckError::Unauthorized(_))
        ));
        // Several Decks: there is no single one to fall back on.
        assert!(matches!(
            scope.resolve(&conn, None),
            Err(JotDeckError::InvalidOperation(_))
        ));
        // A listed id must still exist.
        let stale = pinned(&[&a, "missing"]);
        assert!(matches!(
            stale.resolve(&conn, Some("missing")),
            Err(JotDeckError::NotFound(_))
        ));
    }

    #[test]
    fn any_deck_requires_an_explicit_existing_deck() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
        let scope = DeckScope::AnyDeck;

        assert_eq!(scope.resolve(&conn, Some(&b)).unwrap(), b);
        assert!(matches!(
            scope.resolve(&conn, Some("missing")),
            Err(JotDeckError::NotFound(_))
        ));

        // The GUI's active Deck is a hint only, never an implicit target.
        setting::set_active_deck_id(&conn, &a).unwrap();
        assert!(matches!(
            scope.resolve(&conn, None),
            Err(JotDeckError::InvalidOperation(_))
        ));
        assert!(matches!(
            scope.resolve(&conn, Some("")),
            Err(JotDeckError::InvalidOperation(_))
        ));
    }

    #[test]
    fn deck_for_card_and_column_follow_ownership() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
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

        for scope in [DeckScope::AnyDeck, pinned(&[&b, &a])] {
            assert_eq!(scope.deck_for_card(&conn, &c.id).unwrap(), a);
            assert_eq!(scope.deck_for_column(&conn, &col.id).unwrap(), a);
            assert!(matches!(
                scope.deck_for_card(&conn, "missing"),
                Err(JotDeckError::NotFound(_))
            ));
            assert!(matches!(
                scope.deck_for_column(&conn, "missing"),
                Err(JotDeckError::Unauthorized(_))
            ));
        }

        // Ids in an unlisted Deck look exactly like missing ones.
        let other = pinned(&[&b]);
        assert!(matches!(
            other.deck_for_card(&conn, &c.id),
            Err(JotDeckError::NotFound(_))
        ));
        assert!(matches!(
            other.deck_for_column(&conn, &col.id),
            Err(JotDeckError::Unauthorized(_))
        ));
    }

    #[test]
    fn list_decks_marks_active_and_respects_pin() {
        let conn = create_in_memory().unwrap();
        let a = new_deck(&conn, "A");
        let b = new_deck(&conn, "B");
        let c = new_deck(&conn, "C");
        setting::set_active_deck_id(&conn, &b).unwrap();

        let all = DeckScope::AnyDeck.list_decks(&conn).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|d| d.deck_id == b && d.active));
        assert!(all.iter().any(|d| d.deck_id == a && !d.active));

        let one = pinned(&[&a]).list_decks(&conn).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].deck_id, a);
        assert!(!one[0].active);

        let listed: Vec<_> = pinned(&[&c, &b])
            .list_decks(&conn)
            .unwrap()
            .into_iter()
            .map(|d| (d.deck_id, d.active))
            .collect();
        assert_eq!(listed, vec![(c.clone(), false), (b, true)]);

        // A stale id (Deck deleted since) does not hide the others.
        let stale: Vec<_> = pinned(&[&a, "deleted", &c])
            .list_decks(&conn)
            .unwrap()
            .into_iter()
            .map(|d| d.deck_id)
            .collect();
        assert_eq!(stale, vec![a, c]);
    }
}
