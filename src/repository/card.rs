use chrono::Utc;
use rusqlite::{params, Connection};
use ulid::Ulid;

use crate::error::{JotDeckError, Result};
use crate::models::{Card, NewCard};

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
    let id = Ulid::new().to_string();
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
    })
}

/// 特定の位置に Card を作成する
pub fn create_at_position(conn: &Connection, new_card: NewCard, position: i32) -> Result<Card> {
    let id = Ulid::new().to_string();
    let now = Utc::now();

    // 挿入位置以降の Card の position を +1 する
    conn.execute(
        "UPDATE cards SET position = position + 1, updated_at = ?1 WHERE column_id = ?2 AND position >= ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), &new_card.column_id, position],
    )?;

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
    })
}

fn row_to_card(row: &rusqlite::Row) -> rusqlite::Result<Card> {
    let deleted_at_str: Option<String> = row.get(7)?;
    let deleted_with_column: i32 = row.get(8)?;

    Ok(Card {
        id: row.get(0)?,
        column_id: row.get(1)?,
        content: row.get(2)?,
        score: row.get(3)?,
        position: row.get(4)?,
        created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(5)?)
            .unwrap()
            .with_timezone(&Utc),
        updated_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(6)?)
            .unwrap()
            .with_timezone(&Utc),
        deleted_at: deleted_at_str.map(|s| {
            chrono::DateTime::parse_from_rfc3339(&s)
                .unwrap()
                .with_timezone(&Utc)
        }),
        deleted_with_column: deleted_with_column != 0,
    })
}

/// ID で Card を取得する
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Card> {
    conn.query_row(
        "SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column FROM cards WHERE id = ?1",
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
        "SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column FROM cards WHERE column_id = ?1 AND deleted_at IS NULL ORDER BY position ASC",
    )?;

    let cards = stmt
        .query_map(params![column_id], row_to_card)?
        .filter_map(|r| r.ok())
        .collect();

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

    Ok(Card {
        content: content.to_string(),
        updated_at: now,
        ..card
    })
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

    // 元の Column 内の position を詰める
    conn.execute(
        "UPDATE cards SET position = position - 1, updated_at = ?1 WHERE column_id = ?2 AND position > ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), old_column_id, card.position],
    )?;

    // 新しい Column での position を取得
    let new_position = get_next_position(conn, new_column_id)?;

    conn.execute(
        "UPDATE cards SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_column_id, new_position, now.to_rfc3339(), id],
    )?;

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

    if new_position > old_position {
        // 下に移動: old_position < x <= new_position の Card を -1
        conn.execute(
            "UPDATE cards SET position = position - 1, updated_at = ?1 WHERE column_id = ?2 AND position > ?3 AND position <= ?4 AND deleted_at IS NULL",
            params![now.to_rfc3339(), &card.column_id, old_position, new_position],
        )?;
    } else if new_position < old_position {
        // 上に移動: new_position <= x < old_position の Card を +1
        conn.execute(
            "UPDATE cards SET position = position + 1, updated_at = ?1 WHERE column_id = ?2 AND position >= ?3 AND position < ?4 AND deleted_at IS NULL",
            params![now.to_rfc3339(), &card.column_id, new_position, old_position],
        )?;
    }

    conn.execute(
        "UPDATE cards SET position = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_position, now.to_rfc3339(), id],
    )?;

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

    conn.execute(
        "UPDATE cards SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now.to_rfc3339(), id],
    )?;

    // position を詰める
    conn.execute(
        "UPDATE cards SET position = position - 1, updated_at = ?1 WHERE column_id = ?2 AND position > ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), &card.column_id, card.position],
    )?;

    Ok(())
}

/// Card を復元する
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
    let new_position = get_next_position(conn, &card.column_id)?;

    conn.execute(
        "UPDATE cards SET deleted_at = NULL, position = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_position, now.to_rfc3339(), id],
    )?;

    Ok(Card {
        deleted_at: None,
        position: new_position,
        updated_at: now,
        ..card
    })
}

/// 削除済みの Card 一覧を取得する（ゴミ箱表示用）
pub fn get_deleted(conn: &Connection, column_id: &str) -> Result<Vec<Card>> {
    let mut stmt = conn.prepare(
        "SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column FROM cards WHERE column_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )?;

    let cards = stmt
        .query_map(params![column_id], row_to_card)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(cards)
}

/// Deck 全体の削除済み Card 一覧を取得する
pub fn get_deleted_by_deck(conn: &Connection, deck_id: &str) -> Result<Vec<Card>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.column_id, c.content, c.score, c.position, c.created_at, c.updated_at, c.deleted_at, c.deleted_with_column
         FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE col.deck_id = ?1 AND c.deleted_at IS NOT NULL
         ORDER BY c.deleted_at DESC",
    )?;

    let cards = stmt
        .query_map(params![deck_id], row_to_card)?
        .filter_map(|r| r.ok())
        .collect();

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
}
