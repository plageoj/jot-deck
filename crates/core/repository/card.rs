use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use ulid::Ulid;

use crate::error::{JotDeckError, Result};
use crate::models::{Card, NewCard};
use crate::repository::tag;

/// 占有ロックのリース時間（002 §5.2）。取得からこの秒数を過ぎたロックは失効し、
/// 他者が奪取できる。編集の放棄や書き込み側クラッシュで Card が永久ロックになるのを
/// 防ぐ backstop。手編集側は編集継続中にロックを取り直してリースを延長する。
pub const LOCK_LEASE_SECONDS: i64 = 120;

/// RFC3339 文字列を DateTime<Utc> にパースする
fn parse_datetime(s: &str, col_idx: usize) -> rusqlite::Result<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                col_idx,
                rusqlite::types::Type::Text,
                Box::new(e),
            )
        })
}

/// RFC3339 文字列を Option<DateTime<Utc>> にパースする（deleted_at 用）
fn parse_datetime_opt(s: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

/// 次の position を取得する
fn get_next_position(conn: &Connection, column_id: &str) -> Result<i32> {
    let max_pos: Option<i32> = conn.query_row(
        "SELECT MAX(position) FROM cards WHERE column_id = ?1 AND deleted_at IS NULL",
        params![column_id],
        |row| row.get(0),
    )?;

    Ok(max_pos.unwrap_or(-1) + 1)
}

/// Card を作成する
pub fn create(conn: &Connection, new_card: NewCard) -> Result<Card> {
    let id = Ulid::generate().to_string();
    let now = Utc::now();
    let position = get_next_position(conn, &new_card.column_id)?;

    conn.execute(
        "INSERT INTO cards (id, column_id, content, score, position, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)",
        params![
            &id,
            &new_card.column_id,
            &new_card.content,
            position,
            now.to_rfc3339(),
            now.to_rfc3339(),
        ],
    )?;

    tag::sync_card_tags(conn, &id, &new_card.content)?;

    Ok(Card {
        id,
        column_id: new_card.column_id,
        content: new_card.content,
        score: 0,
        position,
        created_at: now,
        updated_at: now,
        deleted_at: None,
        deleted_with_column: false,
        locked_by: None,
        locked_at: None,
    })
}

/// 特定の位置に Card を作成する
pub fn create_at_position(conn: &Connection, new_card: NewCard, position: i32) -> Result<Card> {
    let id = Ulid::generate().to_string();
    let now = Utc::now();

    let tx = conn.unchecked_transaction()?;

    // 挿入位置以降の Card の position を +1 する
    tx.execute(
        "UPDATE cards SET position = position + 1, updated_at = ?1 WHERE column_id = ?2 AND position >= ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), &new_card.column_id, position],
    )?;

    tx.execute(
        "INSERT INTO cards (id, column_id, content, score, position, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)",
        params![
            &id,
            &new_card.column_id,
            &new_card.content,
            position,
            now.to_rfc3339(),
            now.to_rfc3339(),
        ],
    )?;

    tag::sync_card_tags(&tx, &id, &new_card.content)?;

    tx.commit()?;

    Ok(Card {
        id,
        column_id: new_card.column_id,
        content: new_card.content,
        score: 0,
        position,
        created_at: now,
        updated_at: now,
        deleted_at: None,
        deleted_with_column: false,
        locked_by: None,
        locked_at: None,
    })
}

fn row_to_card(row: &rusqlite::Row) -> rusqlite::Result<Card> {
    let deleted_at_str: Option<String> = row.get(7)?;
    let deleted_with_column: i32 = row.get(8)?;
    let locked_at_str: Option<String> = row.get(10)?;

    Ok(Card {
        id: row.get(0)?,
        column_id: row.get(1)?,
        content: row.get(2)?,
        score: row.get(3)?,
        position: row.get(4)?,
        created_at: parse_datetime(&row.get::<_, String>(5)?, 5)?,
        updated_at: parse_datetime(&row.get::<_, String>(6)?, 6)?,
        deleted_at: deleted_at_str.and_then(|s| parse_datetime_opt(&s)),
        deleted_with_column: deleted_with_column != 0,
        locked_by: row.get(9)?,
        locked_at: locked_at_str.and_then(|s| parse_datetime_opt(&s)),
    })
}

/// ID で Card を取得する
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Card> {
    conn.query_row(
        "SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column, locked_by, locked_at FROM cards WHERE id = ?1",
        params![id],
        row_to_card,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            JotDeckError::NotFound(format!("Card not found: {}", id))
        }
        _ => JotDeckError::Database(e),
    })
}

/// Column 内の Card 一覧を取得する（削除されていないもののみ）
pub fn get_by_column_id(conn: &Connection, column_id: &str) -> Result<Vec<Card>> {
    let mut stmt = conn.prepare(
        "SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column, locked_by, locked_at FROM cards WHERE column_id = ?1 AND deleted_at IS NULL ORDER BY position ASC",
    )?;

    let cards = stmt
        .query_map(params![column_id], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(cards)
}

/// Card の内容を更新する
pub fn update_content(conn: &Connection, id: &str, content: &str) -> Result<Card> {
    let card = get_by_id(conn, id)?;

    if card.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Cannot update deleted card".to_string(),
        ));
    }

    let now = Utc::now();

    conn.execute(
        "UPDATE cards SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, now.to_rfc3339(), id],
    )?;

    tag::sync_card_tags(conn, id, content)?;

    Ok(Card {
        content: content.to_string(),
        updated_at: now,
        ..card
    })
}

/// 条件付き UPDATE が 0 行だったときの失敗理由を判定して返す（002 §5 の書き込み系で共有）。
/// カードが存在しなければ `get_by_id` の `NotFound` を伝播し、削除済みなら
/// `InvalidOperation(deleted_msg)`、それ以外は再読込したカードから作った
/// `Conflict(conflict(card))` を返す。
fn classify_write_failure(
    conn: &Connection,
    id: &str,
    deleted_msg: &str,
    conflict: impl FnOnce(&Card) -> String,
) -> JotDeckError {
    match get_by_id(conn, id) {
        Err(e) => e,
        Ok(card) if card.deleted_at.is_some() => {
            JotDeckError::InvalidOperation(deleted_msg.to_string())
        }
        Ok(card) => JotDeckError::Conflict(conflict(&card)),
    }
}

/// 楽観ロック（compare-and-swap）付きで content を更新する（002 §5.3）。
///
/// `expected_updated_at` が現在の `updated_at` と一致するときだけ適用し、`updated_at`
/// を進める。一致しなければ（読んだ後に他者が更新済み）`Conflict` を返す ―― 呼び出し
/// 側は再読込して再試行する。占有ロックとは独立で、ロックを取らない短い確定編集どうし
/// のロスト更新を防ぐ。判定と更新は 1 本の条件付き UPDATE で行うため、複数プロセスが
/// 同一ファイルを開いていても取り違えない。
pub fn update_content_cas(
    conn: &Connection,
    id: &str,
    content: &str,
    expected_updated_at: DateTime<Utc>,
) -> Result<Card> {
    let now = Utc::now();
    let affected = conn.execute(
        "UPDATE cards SET content = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4 AND deleted_at IS NULL",
        params![content, now.to_rfc3339(), id, expected_updated_at.to_rfc3339()],
    )?;

    if affected == 1 {
        tag::sync_card_tags(conn, id, content)?;
        return get_by_id(conn, id);
    }

    // 0 行更新: 存在しない/削除済み or updated_at 不一致。区別して返す。
    Err(classify_write_failure(conn, id, "Cannot update deleted card", |_| {
        "Card was modified since it was read (expected_updated_at mismatch)".to_string()
    }))
}

/// 占有ロックを取得する（002 §5.2）。
///
/// 未占有・リース失効・同一所有者による取り直しのいずれかなら成功し、`locked_by` を
/// `locked_by_id` に、`locked_at` を現在時刻に更新する（同一所有者の取り直しはリースの
/// 延長になる）。他者が有効に占有していれば `Conflict` を返す。取得は content 書き込み
/// ではないため `updated_at` は進めない。判定と更新は 1 本の条件付き UPDATE で行い、
/// 複数プロセス間でも二重取得しない。
pub fn acquire_lock(conn: &Connection, id: &str, locked_by_id: &str) -> Result<Card> {
    let now = Utc::now();
    let cutoff = (now - chrono::Duration::seconds(LOCK_LEASE_SECONDS)).to_rfc3339();
    let affected = conn.execute(
        "UPDATE cards SET locked_by = ?1, locked_at = ?2
         WHERE id = ?3 AND deleted_at IS NULL
           AND (locked_by IS NULL OR locked_by = ?1 OR locked_at IS NULL OR locked_at < ?4)",
        params![locked_by_id, now.to_rfc3339(), id, cutoff],
    )?;

    if affected == 1 {
        return get_by_id(conn, id);
    }

    // 0 行更新: 存在しない/削除済み or 他者が有効占有中。区別して返す。
    Err(classify_write_failure(conn, id, "Cannot lock deleted card", |card| {
        format!(
            "Card is locked by {}",
            card.locked_by.as_deref().unwrap_or("another editor")
        )
    }))
}

/// 占有ロックを解放する（002 §5.2）。`locked_by_id` が現在の所有者と一致するときだけ
/// `locked_by`/`locked_at` をクリアする。所有者でなければ何もしない（既に失効・他者が
/// 奪取済みのケースを冪等に扱う）。
pub fn release_lock(conn: &Connection, id: &str, locked_by_id: &str) -> Result<Card> {
    conn.execute(
        "UPDATE cards SET locked_by = NULL, locked_at = NULL WHERE id = ?1 AND locked_by = ?2",
        params![id, locked_by_id],
    )?;
    get_by_id(conn, id)
}

/// Card のスコアを更新する
pub fn update_score(conn: &Connection, id: &str, delta: i32) -> Result<Card> {
    let card = get_by_id(conn, id)?;

    if card.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Cannot update deleted card".to_string(),
        ));
    }

    let now = Utc::now();
    let new_score = card.score + delta;

    conn.execute(
        "UPDATE cards SET score = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_score, now.to_rfc3339(), id],
    )?;

    Ok(Card {
        score: new_score,
        updated_at: now,
        ..card
    })
}

/// Card を別の Column に移動する
pub fn move_to_column(conn: &Connection, id: &str, new_column_id: &str) -> Result<Card> {
    let card = get_by_id(conn, id)?;

    if card.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Cannot move deleted card".to_string(),
        ));
    }

    let now = Utc::now();
    let old_column_id = &card.column_id;

    let tx = conn.unchecked_transaction()?;

    // 元の Column 内の position を詰める
    tx.execute(
        "UPDATE cards SET position = position - 1, updated_at = ?1 WHERE column_id = ?2 AND position > ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), old_column_id, card.position],
    )?;

    // 新しい Column での position を取得（トランザクション内で実行）
    let new_position: i32 = {
        let max_pos: Option<i32> = tx.query_row(
            "SELECT MAX(position) FROM cards WHERE column_id = ?1 AND deleted_at IS NULL",
            params![new_column_id],
            |row| row.get(0),
        )?;
        max_pos.unwrap_or(-1) + 1
    };

    tx.execute(
        "UPDATE cards SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_column_id, new_position, now.to_rfc3339(), id],
    )?;

    tx.commit()?;

    Ok(Card {
        column_id: new_column_id.to_string(),
        position: new_position,
        updated_at: now,
        ..card
    })
}

/// Card を Column 内で移動する（並び替え）
pub fn move_to_position(conn: &Connection, id: &str, new_position: i32) -> Result<Card> {
    let card = get_by_id(conn, id)?;

    if card.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Cannot move deleted card".to_string(),
        ));
    }

    let old_position = card.position;
    let now = Utc::now();

    let tx = conn.unchecked_transaction()?;

    if new_position > old_position {
        // 下に移動: old_position < x <= new_position の Card を -1
        tx.execute(
            "UPDATE cards SET position = position - 1, updated_at = ?1 WHERE column_id = ?2 AND position > ?3 AND position <= ?4 AND deleted_at IS NULL",
            params![now.to_rfc3339(), &card.column_id, old_position, new_position],
        )?;
    } else if new_position < old_position {
        // 上に移動: new_position <= x < old_position の Card を +1
        tx.execute(
            "UPDATE cards SET position = position + 1, updated_at = ?1 WHERE column_id = ?2 AND position >= ?3 AND position < ?4 AND deleted_at IS NULL",
            params![now.to_rfc3339(), &card.column_id, new_position, old_position],
        )?;
    }

    tx.execute(
        "UPDATE cards SET position = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_position, now.to_rfc3339(), id],
    )?;

    tx.commit()?;

    Ok(Card {
        position: new_position,
        updated_at: now,
        ..card
    })
}

/// Card を論理削除する
pub fn soft_delete(conn: &Connection, id: &str) -> Result<()> {
    let card = get_by_id(conn, id)?;

    if card.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Card is already deleted".to_string(),
        ));
    }

    let now = Utc::now();

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "UPDATE cards SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now.to_rfc3339(), id],
    )?;

    // position を詰める
    tx.execute(
        "UPDATE cards SET position = position - 1, updated_at = ?1 WHERE column_id = ?2 AND position > ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), &card.column_id, card.position],
    )?;

    tx.commit()?;

    Ok(())
}

/// Card を復元する（元の位置に挿入）
pub fn restore(conn: &Connection, id: &str) -> Result<Card> {
    let card = get_by_id(conn, id)?;

    if card.deleted_at.is_none() {
        return Err(JotDeckError::InvalidOperation(
            "Card is not deleted".to_string(),
        ));
    }

    // 連動削除された Card は Column の復元時に復元されるので、単体では復元できない
    if card.deleted_with_column {
        return Err(JotDeckError::InvalidOperation(
            "Cannot restore card that was deleted with column. Restore the column instead.".to_string(),
        ));
    }

    let now = Utc::now();
    let restore_position = card.position;

    let tx = conn.unchecked_transaction()?;

    // 復元位置以降の Card の position を +1 する
    tx.execute(
        "UPDATE cards SET position = position + 1, updated_at = ?1 WHERE column_id = ?2 AND position >= ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), &card.column_id, restore_position],
    )?;

    tx.execute(
        "UPDATE cards SET deleted_at = NULL, position = ?1, updated_at = ?2 WHERE id = ?3",
        params![restore_position, now.to_rfc3339(), id],
    )?;

    tx.commit()?;

    Ok(Card {
        deleted_at: None,
        position: restore_position,
        updated_at: now,
        ..card
    })
}

/// 削除済みの Card 一覧を取得する（ゴミ箱表示用）
pub fn get_deleted(conn: &Connection, column_id: &str) -> Result<Vec<Card>> {
    let mut stmt = conn.prepare(
        "SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column, locked_by, locked_at FROM cards WHERE column_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )?;

    let cards = stmt
        .query_map(params![column_id], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(cards)
}

/// Deck 全体の削除済み Card 一覧を取得する
pub fn get_deleted_by_deck(conn: &Connection, deck_id: &str) -> Result<Vec<Card>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.column_id, c.content, c.score, c.position, c.created_at, c.updated_at, c.deleted_at, c.deleted_with_column, c.locked_by, c.locked_at
         FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE col.deck_id = ?1 AND c.deleted_at IS NOT NULL
         ORDER BY c.deleted_at DESC",
    )?;

    let cards = stmt
        .query_map(params![deck_id], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(cards)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewColumn, NewDeck, SortOrder};
    use crate::repository::{column, deck};

    fn setup() -> (Connection, String, String) {
        let conn = create_in_memory().unwrap();
        let d = deck::create(
            &conn,
            NewDeck {
                name: "Test Deck".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        let col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Test Column".to_string(),
            },
        )
        .unwrap();
        (conn, d.id, col.id)
    }

    #[test]
    fn test_create_card() {
        let (conn, _, column_id) = setup();

        let card = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "Test content".to_string(),
            },
        )
        .unwrap();

        assert_eq!(card.content, "Test content");
        assert_eq!(card.score, 0);
        assert_eq!(card.position, 0);
    }

    #[test]
    fn test_update_score() {
        let (conn, _, column_id) = setup();

        let card = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "Test".to_string(),
            },
        )
        .unwrap();

        let updated = update_score(&conn, &card.id, 1).unwrap();
        assert_eq!(updated.score, 1);

        let updated = update_score(&conn, &card.id, -2).unwrap();
        assert_eq!(updated.score, -1);
    }

    #[test]
    fn test_soft_delete_and_restore() {
        let (conn, _, column_id) = setup();

        let card = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "Test".to_string(),
            },
        )
        .unwrap();

        soft_delete(&conn, &card.id).unwrap();

        let deleted = get_by_id(&conn, &card.id).unwrap();
        assert!(deleted.deleted_at.is_some());

        let cards = get_by_column_id(&conn, &column_id).unwrap();
        assert!(cards.is_empty());

        let restored = restore(&conn, &card.id).unwrap();
        assert!(restored.deleted_at.is_none());
    }

    #[test]
    fn test_restore_to_original_position() {
        let (conn, _, column_id) = setup();

        // A, B, C の順で作成
        let card_a = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "A".to_string(),
            },
        )
        .unwrap();
        let card_b = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "B".to_string(),
            },
        )
        .unwrap();
        let _card_c = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "C".to_string(),
            },
        )
        .unwrap();

        // B を削除 -> (A, C)
        soft_delete(&conn, &card_b.id).unwrap();
        let cards = get_by_column_id(&conn, &column_id).unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].content, "A");
        assert_eq!(cards[1].content, "C");

        // B を復元 -> (A, B, C) に戻る
        let restored = restore(&conn, &card_b.id).unwrap();
        assert_eq!(restored.position, 1); // 元の位置

        let cards = get_by_column_id(&conn, &column_id).unwrap();
        assert_eq!(cards.len(), 3);
        assert_eq!(cards[0].content, "A");
        assert_eq!(cards[1].content, "B");
        assert_eq!(cards[2].content, "C");

        // A を削除 -> (B, C)
        soft_delete(&conn, &card_a.id).unwrap();
        let cards = get_by_column_id(&conn, &column_id).unwrap();
        assert_eq!(cards[0].content, "B");
        assert_eq!(cards[1].content, "C");

        // A を復元 -> (A, B, C) に戻る
        restore(&conn, &card_a.id).unwrap();
        let cards = get_by_column_id(&conn, &column_id).unwrap();
        assert_eq!(cards[0].content, "A");
        assert_eq!(cards[1].content, "B");
        assert_eq!(cards[2].content, "C");
    }

    #[test]
    fn test_move_card() {
        let (conn, _deck_id, column_id) = setup();

        let card1 = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "A".to_string(),
            },
        )
        .unwrap();
        let _card2 = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "B".to_string(),
            },
        )
        .unwrap();
        let _card3 = create(
            &conn,
            NewCard {
                column_id: column_id.clone(),
                content: "C".to_string(),
            },
        )
        .unwrap();

        // card1 を position 2 に移動 (A, B, C) -> (B, C, A)
        move_to_position(&conn, &card1.id, 2).unwrap();

        let cards = get_by_column_id(&conn, &column_id).unwrap();
        assert_eq!(cards[0].content, "B");
        assert_eq!(cards[1].content, "C");
        assert_eq!(cards[2].content, "A");
    }

    #[test]
    fn test_move_to_column() {
        let (conn, deck_id, column_id1) = setup();

        let col2 = column::create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "Column 2".to_string(),
            },
        )
        .unwrap();

        let card = create(
            &conn,
            NewCard {
                column_id: column_id1.clone(),
                content: "Test".to_string(),
            },
        )
        .unwrap();

        move_to_column(&conn, &card.id, &col2.id).unwrap();

        let cards1 = get_by_column_id(&conn, &column_id1).unwrap();
        let cards2 = get_by_column_id(&conn, &col2.id).unwrap();

        assert!(cards1.is_empty());
        assert_eq!(cards2.len(), 1);
        assert_eq!(cards2[0].content, "Test");
    }

    fn new_card(conn: &Connection, column_id: &str) -> Card {
        create(
            conn,
            NewCard {
                column_id: column_id.to_string(),
                content: "hello".to_string(),
            },
        )
        .unwrap()
    }

    #[test]
    fn test_new_card_is_unlocked() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);
        assert!(card.locked_by.is_none());
        assert!(card.locked_at.is_none());
    }

    #[test]
    fn test_acquire_lock_when_free() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);

        let locked = acquire_lock(&conn, &card.id, "user").unwrap();
        assert_eq!(locked.locked_by.as_deref(), Some("user"));
        assert!(locked.locked_at.is_some());
        // 占有取得は content 書き込みではないので updated_at は進まない。
        assert_eq!(locked.updated_at, card.updated_at);
    }

    #[test]
    fn test_acquire_lock_conflicts_for_other_owner() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);

        acquire_lock(&conn, &card.id, "user").unwrap();
        let err = acquire_lock(&conn, &card.id, "agent:mcp").unwrap_err();
        assert!(matches!(err, JotDeckError::Conflict(_)));
    }

    #[test]
    fn test_same_owner_reacquire_extends_lease() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);

        let first = acquire_lock(&conn, &card.id, "user").unwrap();
        let second = acquire_lock(&conn, &card.id, "user").unwrap();
        assert_eq!(second.locked_by.as_deref(), Some("user"));
        // 取り直しで locked_at が進む（リース延長）。
        assert!(second.locked_at.unwrap() >= first.locked_at.unwrap());
    }

    #[test]
    fn test_expired_lease_can_be_taken_over() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);

        acquire_lock(&conn, &card.id, "user").unwrap();
        // locked_at をリースを超えて過去へ戻し、失効状態を作る。
        let stale = (Utc::now() - chrono::Duration::seconds(LOCK_LEASE_SECONDS + 60)).to_rfc3339();
        conn.execute(
            "UPDATE cards SET locked_at = ?1 WHERE id = ?2",
            params![stale, card.id],
        )
        .unwrap();

        // 失効しているので他者が奪取できる。
        let taken = acquire_lock(&conn, &card.id, "agent:mcp").unwrap();
        assert_eq!(taken.locked_by.as_deref(), Some("agent:mcp"));
    }

    #[test]
    fn test_release_lock_by_owner_and_non_owner() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);

        acquire_lock(&conn, &card.id, "user").unwrap();

        // 非所有者の解放は無視される（占有は保持）。
        let after_bad = release_lock(&conn, &card.id, "agent:mcp").unwrap();
        assert_eq!(after_bad.locked_by.as_deref(), Some("user"));

        // 所有者の解放でクリアされる。
        let after_good = release_lock(&conn, &card.id, "user").unwrap();
        assert!(after_good.locked_by.is_none());
        assert!(after_good.locked_at.is_none());
    }

    #[test]
    fn test_cannot_lock_deleted_card() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);
        soft_delete(&conn, &card.id).unwrap();

        let err = acquire_lock(&conn, &card.id, "user").unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }

    #[test]
    fn test_update_content_cas_applies_on_match() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);

        let updated =
            update_content_cas(&conn, &card.id, "new body #tag", card.updated_at).unwrap();
        assert_eq!(updated.content, "new body #tag");
        assert!(updated.updated_at > card.updated_at);
    }

    #[test]
    fn test_update_content_cas_rejects_stale() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);

        // 先に一度更新して updated_at を進める。
        let fresh = update_content_cas(&conn, &card.id, "first", card.updated_at).unwrap();

        // 古い updated_at での再更新は Conflict。
        let err = update_content_cas(&conn, &card.id, "second", card.updated_at).unwrap_err();
        assert!(matches!(err, JotDeckError::Conflict(_)));

        // 最新値でならもう一度通る。
        update_content_cas(&conn, &card.id, "second", fresh.updated_at).unwrap();
    }

    #[test]
    fn test_update_content_cas_on_deleted_card() {
        let (conn, _, column_id) = setup();
        let card = new_card(&conn, &column_id);
        soft_delete(&conn, &card.id).unwrap();

        let err = update_content_cas(&conn, &card.id, "x", card.updated_at).unwrap_err();
        assert!(matches!(err, JotDeckError::InvalidOperation(_)));
    }
}
