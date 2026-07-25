//! Deck-scoped write operations backing the MCP write surface (008-mcp-server.md §4.1).
//!
//! Like `query.rs`, this is the trust boundary: visibility (deck membership,
//! `private`, deleted) is enforced here in core, never in the untrusted bridge
//! (008 §4.5). Writes only touch columns/cards inside the connection Deck's
//! visible range; anything outside is reported as `NotFound` (cards, to avoid
//! leaking existence) or `Unauthorized` (an explicitly named column).
//!
//! Capability gating (append/edit/delete) and per-connection rate limiting are
//! policy the bridge layers on top — they are about *what a connection may
//! invoke*, not *what data exists* — so they live in the bridge, not here.
//!
//! Numbering (ULID / position) and tag extraction stay centralized in the `card`
//! repository; this module validates scope, resolves move anchors to positions,
//! and delegates the mutation.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{JotDeckError, Result};
use crate::models::{Card, NewCard};
use crate::repository::{card, query};

/// 指定カラムが接続 Deck の可視・書き込み可能範囲にあることを検証する。
/// 範囲外（別 Deck / private / 削除済み / 不在）なら Unauthorized。
fn ensure_column_writable(conn: &Connection, deck_id: &str, column_id: &str) -> Result<()> {
    if query::is_column_visible(conn, deck_id, column_id)? {
        Ok(())
    } else {
        Err(JotDeckError::Unauthorized(format!(
            "Column not accessible: {}",
            column_id
        )))
    }
}

/// 指定カードが接続 Deck の可視カラムに属し、生存していることを検証して返す。
/// 可視範囲外・削除済み・別 Deck・不在はいずれも存在を漏らさず NotFound（008 §4.5）。
fn visible_card(conn: &Connection, deck_id: &str, card_id: &str) -> Result<Card> {
    let not_found = || JotDeckError::NotFound(format!("Card not found: {}", card_id));
    let c = card::get_by_id(conn, card_id).map_err(|_| not_found())?;
    if c.deleted_at.is_some() {
        return Err(not_found());
    }
    if !query::is_column_visible(conn, deck_id, &c.column_id)? {
        return Err(not_found());
    }
    Ok(c)
}

/// カード本文の長さ backstop を検査する（008 §5）。これは**外部エージェント書き込みの
/// 抑止**（暴走 append の backstop）であり、GUI/CLI の手編集に課す普遍的な不変条件では
/// ない ―― だから `card::create` / `update_content_cas` ではなく、この MCP 書き込み面に
/// 置く。超過時は分割を促すエラーを返し、エージェントを正しい振る舞いへ誘導する。
fn ensure_card_length(content: &str) -> Result<()> {
    let len = content.chars().count();
    if len > query::MAX_CARD_LENGTH {
        return Err(JotDeckError::InvalidOperation(format!(
            "Card content too long: {} chars (max {}). Split it into several shorter cards.",
            len,
            query::MAX_CARD_LENGTH
        )));
    }
    Ok(())
}

fn lookup_idempotent(conn: &Connection, deck_id: &str, key: &str) -> Result<Option<String>> {
    let id: Option<String> = conn
        .query_row(
            "SELECT card_id FROM idempotency_keys WHERE deck_id = ?1 AND key = ?2",
            params![deck_id, key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(id)
}

/// カラム末尾にカードを作成する（`append_card`）。
///
/// `idempotency_key` を添えると、同一 (deck, key) の再送は新規作成せず既存カードを
/// 返す（ホスト再送での重複防止 → 008 §5）。position 採番・ULID 発番・`#tag` 抽出は
/// `card` リポジトリが担う。
pub fn append_card(
    conn: &Connection,
    deck_id: &str,
    column_id: &str,
    content: &str,
    idempotency_key: Option<&str>,
) -> Result<Card> {
    ensure_column_writable(conn, deck_id, column_id)?;
    ensure_card_length(content)?;

    // 冪等キーが既にあれば、その時点のカードを返す（再送＝no-op）。可視性ゲートを
    // 通すので、写像先カードが private カラムへ移動 / 削除済みなら NotFound になり、
    // 書き込み境界からアクセス不可な内容を漏らさない（008 §4.5）。
    if let Some(key) = idempotency_key {
        if let Some(existing) = lookup_idempotent(conn, deck_id, key)? {
            return visible_card(conn, deck_id, &existing);
        }
    }

    let tx = conn.unchecked_transaction()?;
    let created = card::create(
        &tx,
        NewCard {
            column_id: column_id.to_string(),
            content: content.to_string(),
        },
    )?;
    if let Some(key) = idempotency_key {
        // 同一キーで別プロセスが並行に先着した場合、PK 制約で例外にせず OR IGNORE で
        // 0 行を検知し、自分が作ったカードを破棄（tx ロールバック）して先着カードを返す
        // ―― 再送安全の約束を並行下でも保つ。
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO idempotency_keys (deck_id, key, card_id, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![deck_id, key, created.id, Utc::now().to_rfc3339()],
        )?;
        if inserted == 0 {
            drop(tx); // 未 commit のまま破棄 → 作成したカードを取り消す
            let winner = lookup_idempotent(conn, deck_id, key)?.ok_or_else(|| {
                JotDeckError::Conflict("idempotency race left no resolvable key".to_string())
            })?;
            return visible_card(conn, deck_id, &winner);
        }
    }
    tx.commit()?;
    Ok(created)
}

/// 既存カードの本文を確定 edit する（`patch_card`）。楽観ロック（`expected_updated_at`
/// の compare-and-swap）で lost update を防ぐ（002 §5.3）。
pub fn patch_card(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    content: &str,
    expected_updated_at: chrono::DateTime<Utc>,
) -> Result<Card> {
    visible_card(conn, deck_id, card_id)?;
    ensure_card_length(content)?;
    card::update_content_cas(conn, card_id, content, expected_updated_at)
}

/// カードを論理削除する（`delete_card`）。物理削除・復元はエージェントに公開せず、
/// 30 日後の cleanup とユーザの削除スタックに委ねる（008 §4.1）。
pub fn delete_card(conn: &Connection, deck_id: &str, card_id: &str) -> Result<Card> {
    visible_card(conn, deck_id, card_id)?;
    card::soft_delete(conn, card_id)?;
    card::get_by_id(conn, card_id)
}

/// カードをカラム間移動 / 並べ替えする（`move_card`）。
///
/// 移動先は接続 Deck 内の可視カラムに限る（Deck 越え不可 → 008 §4.4）。順序は生の
/// position ではなく **アンカー**（`before_card_id` / `after_card_id`）で表明し、実際の
/// position は本体が採番する。どちらも省略すると移動先の末尾。両方指定はエラー。
/// 同じ位置への move は no-op（再送に安全）。
pub fn move_card(
    conn: &Connection,
    deck_id: &str,
    card_id: &str,
    to_column_id: Option<&str>,
    before_card_id: Option<&str>,
    after_card_id: Option<&str>,
) -> Result<Card> {
    if before_card_id.is_some() && after_card_id.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Specify only one of before_card_id / after_card_id".to_string(),
        ));
    }

    let card = visible_card(conn, deck_id, card_id)?;
    let target_col = to_column_id.unwrap_or(&card.column_id);
    ensure_column_writable(conn, deck_id, target_col)?;

    // 移動先カラムの生存カードを position 順に、移動対象を除いて列挙する。card
    // リポジトリの列挙を再利用し、順序/論理削除の規則をここに二重で持たない。
    // アンカーはこの列（＝挿入位置の基準集合）に対する index として解決する。
    let others: Vec<String> = card::get_by_column_id(conn, target_col)?
        .into_iter()
        .map(|c| c.id)
        .filter(|id| id != card_id)
        .collect();

    let anchor_index = |anchor: &str| -> Result<usize> {
        others
            .iter()
            .position(|id| id == anchor)
            .ok_or_else(|| {
                JotDeckError::InvalidOperation(format!(
                    "Anchor card not found in target column: {}",
                    anchor
                ))
            })
    };

    // 挿入先 index（移動対象を除いた列の 0..=len）。
    let target_index = match (before_card_id, after_card_id) {
        (Some(before), None) => anchor_index(before)?,
        (None, Some(after)) => anchor_index(after)? + 1,
        _ => others.len(),
    };

    // カラムを跨ぐ場合はまず移動先の末尾へ運び（採番一元化）、続いて目的 index へ寄せる。
    // 現状は 2 つの確定トランザクション（末尾へ移動→再配置）。単一トランザクションの
    // アンカー対応 reorder プリミティブへの集約は将来課題（中間の末尾位置が一瞬観測され得る）。
    if target_col != card.column_id {
        card::move_to_column(conn, card_id, target_col)?;
    }
    // このとき対象は移動先カラムに属し、全 len+1 件中の dense index を target_index にする。
    card::move_to_position(conn, card_id, target_index as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewColumn, NewDeck, SortOrder};
    use crate::repository::{card, column, deck};

    struct Fixture {
        conn: Connection,
        deck_id: String,
        public_col: String,
        private_col: String,
    }

    fn setup() -> Fixture {
        let conn = create_in_memory().unwrap();
        let d = deck::create(
            &conn,
            NewDeck {
                name: "KB".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let public_col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Public".to_string(),
            },
        )
        .unwrap();
        let private_col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Secret".to_string(),
            },
        )
        .unwrap();
        column::update(&conn, &private_col.id, None, None, Some(true)).unwrap();
        Fixture {
            conn,
            deck_id: d.id,
            public_col: public_col.id,
            private_col: private_col.id,
        }
    }

    fn contents(f: &Fixture, col: &str) -> Vec<String> {
        card::get_by_column_id(&f.conn, col)
            .unwrap()
            .into_iter()
            .map(|c| c.content)
            .collect()
    }

    #[test]
    fn append_creates_card_at_tail() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "first", None).unwrap();
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "second", None).unwrap();
        assert_eq!(a.position, 0);
        assert_eq!(b.position, 1);
        assert_eq!(contents(&f, &f.public_col), vec!["first", "second"]);
    }

    #[test]
    fn append_to_private_column_is_unauthorized() {
        let f = setup();
        let err = append_card(&f.conn, &f.deck_id, &f.private_col, "x", None).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn append_to_other_deck_column_is_unauthorized() {
        let f = setup();
        let other = deck::create(
            &f.conn,
            NewDeck {
                name: "Other".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let other_col = column::create(
            &f.conn,
            NewColumn {
                deck_id: other.id,
                name: "Elsewhere".to_string(),
            },
        )
        .unwrap();
        let err = append_card(&f.conn, &f.deck_id, &other_col.id, "x", None).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn append_rejects_too_long_content() {
        let f = setup();
        let long = "a".repeat(query::MAX_CARD_LENGTH + 1);
        let err = append_card(&f.conn, &f.deck_id, &f.public_col, &long, None).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    #[test]
    fn append_is_idempotent_per_key() {
        let f = setup();
        let first = append_card(&f.conn, &f.deck_id, &f.public_col, "once", Some("k1")).unwrap();
        // 同一キーの再送は新規作成せず同じ id を返す。
        let again = append_card(&f.conn, &f.deck_id, &f.public_col, "ignored", Some("k1")).unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(again.content, "once");
        assert_eq!(card::get_by_column_id(&f.conn, &f.public_col).unwrap().len(), 1);
    }

    #[test]
    fn idempotent_replay_of_card_moved_to_private_is_not_found() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "orig", Some("k")).unwrap();
        // The mapped card is later moved into the private column.
        card::move_to_column(&f.conn, &a.id, &f.private_col).unwrap();
        // Resending to the (still writable) public column must not hand back the
        // now-inaccessible card through the write surface.
        let err = append_card(&f.conn, &f.deck_id, &f.public_col, "x", Some("k")).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn idempotency_key_is_purged_when_card_is_physically_deleted() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "orig", Some("k")).unwrap();
        // Simulate the 30-day cleanup physically removing the card; the ON DELETE
        // CASCADE FK drops the idempotency key with it.
        f.conn
            .execute("DELETE FROM cards WHERE id = ?1", params![a.id])
            .unwrap();
        // The same key now creates a fresh card instead of resolving to the gone one.
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "again", Some("k")).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(b.content, "again");
    }

    #[test]
    fn idempotency_is_scoped_per_deck() {
        let f = setup();
        // 別 Deck で同じキーを使っても衝突しない。
        let other = deck::create(
            &f.conn,
            NewDeck {
                name: "Other".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let other_col = column::create(
            &f.conn,
            NewColumn {
                deck_id: other.id.clone(),
                name: "C".to_string(),
            },
        )
        .unwrap();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "deck a", Some("dup")).unwrap();
        let b = append_card(&f.conn, &other.id, &other_col.id, "deck b", Some("dup")).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(a.content, "deck a");
        assert_eq!(b.content, "deck b");
    }

    #[test]
    fn patch_updates_with_matching_cas() {
        let f = setup();
        let c = append_card(&f.conn, &f.deck_id, &f.public_col, "orig", None).unwrap();
        let updated = patch_card(&f.conn, &f.deck_id, &c.id, "new #tag", c.updated_at).unwrap();
        assert_eq!(updated.content, "new #tag");
        assert!(updated.updated_at > c.updated_at);
    }

    #[test]
    fn patch_rejects_stale_cas() {
        let f = setup();
        let c = append_card(&f.conn, &f.deck_id, &f.public_col, "orig", None).unwrap();
        patch_card(&f.conn, &f.deck_id, &c.id, "first", c.updated_at).unwrap();
        // 古い updated_at での patch は Conflict。
        let err = patch_card(&f.conn, &f.deck_id, &c.id, "second", c.updated_at).unwrap_err();
        assert!(matches!(err, JotDeckError::Conflict(_)));
    }

    #[test]
    fn patch_on_private_card_is_not_found() {
        let f = setup();
        let hidden = card::create(
            &f.conn,
            NewCard {
                column_id: f.private_col.clone(),
                content: "secret".to_string(),
            },
        )
        .unwrap();
        let err = patch_card(&f.conn, &f.deck_id, &hidden.id, "x", hidden.updated_at).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn delete_soft_deletes_visible_card() {
        let f = setup();
        let c = append_card(&f.conn, &f.deck_id, &f.public_col, "bye", None).unwrap();
        let deleted = delete_card(&f.conn, &f.deck_id, &c.id).unwrap();
        assert!(deleted.deleted_at.is_some());
        assert!(card::get_by_column_id(&f.conn, &f.public_col).unwrap().is_empty());
    }

    #[test]
    fn delete_on_private_card_is_not_found() {
        let f = setup();
        let hidden = card::create(
            &f.conn,
            NewCard {
                column_id: f.private_col.clone(),
                content: "secret".to_string(),
            },
        )
        .unwrap();
        let err = delete_card(&f.conn, &f.deck_id, &hidden.id).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn move_within_column_before_anchor() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None).unwrap();
        let _b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None).unwrap();
        let _c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None).unwrap();

        // A を C の前へ: (A,B,C) -> (B,A,C)
        move_card(&f.conn, &f.deck_id, &a.id, None, Some(&_c.id), None).unwrap();
        assert_eq!(contents(&f, &f.public_col), vec!["B", "A", "C"]);
    }

    #[test]
    fn move_within_column_after_anchor() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None).unwrap();
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None).unwrap();
        let _c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None).unwrap();

        // A を B の後ろへ: (A,B,C) -> (B,A,C)
        move_card(&f.conn, &f.deck_id, &a.id, None, None, Some(&b.id)).unwrap();
        assert_eq!(contents(&f, &f.public_col), vec!["B", "A", "C"]);
    }

    #[test]
    fn move_to_tail_when_no_anchor() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None).unwrap();
        let _b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None).unwrap();
        let _c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None).unwrap();

        move_card(&f.conn, &f.deck_id, &a.id, None, None, None).unwrap();
        assert_eq!(contents(&f, &f.public_col), vec!["B", "C", "A"]);
    }

    #[test]
    fn move_across_columns_to_anchor() {
        let f = setup();
        let second = column::create(
            &f.conn,
            NewColumn {
                deck_id: f.deck_id.clone(),
                name: "Second".to_string(),
            },
        )
        .unwrap();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None).unwrap();
        let x = append_card(&f.conn, &f.deck_id, &second.id, "X", None).unwrap();
        let _y = append_card(&f.conn, &f.deck_id, &second.id, "Y", None).unwrap();

        // A を Second カラムの X の前へ移動: Second -> (A, X, Y)
        let moved = move_card(&f.conn, &f.deck_id, &a.id, Some(&second.id), Some(&x.id), None).unwrap();
        assert_eq!(moved.column_id, second.id);
        assert_eq!(moved.position, 0);
        assert!(contents(&f, &f.public_col).is_empty());
        assert_eq!(contents(&f, &second.id), vec!["A", "X", "Y"]);
    }

    #[test]
    fn move_into_private_column_is_unauthorized() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None).unwrap();
        let err = move_card(&f.conn, &f.deck_id, &a.id, Some(&f.private_col), None, None).unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn move_rejects_both_anchors() {
        let f = setup();
        let a = append_card(&f.conn, &f.deck_id, &f.public_col, "A", None).unwrap();
        let b = append_card(&f.conn, &f.deck_id, &f.public_col, "B", None).unwrap();
        let c = append_card(&f.conn, &f.deck_id, &f.public_col, "C", None).unwrap();
        let err = move_card(&f.conn, &f.deck_id, &a.id, None, Some(&b.id), Some(&c.id)).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }
}
