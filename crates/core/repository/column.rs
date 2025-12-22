use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use ulid::Ulid;

use crate::error::{JotDeckError, Result};
use crate::models::{Column, NewColumn};

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

/// 数値をアルファベット列名に変換する (0 -> "a", 25 -> "z", 26 -> "aa", ...)
fn to_alphabetic(n: u32) -> String {
    let mut result = String::new();
    let mut num = n + 1; // 1-indexed bijective base-26
    while num > 0 {
        num -= 1;
        let c = (b'a' + (num % 26) as u8) as char;
        result.insert(0, c);
        num /= 26;
    }
    result
}

/// 次の Column 名を自動生成する
/// a-col, b-col, ..., z-col, aa-col, ab-col, ..., zz-col, aaa-col, ...
fn generate_column_name(conn: &Connection, deck_id: &str) -> Result<String> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM columns WHERE deck_id = ?1",
        params![deck_id],
        |row| row.get(0),
    )?;

    let prefix = to_alphabetic(count as u32);
    Ok(format!("{}-col", prefix))
}

/// 次の position を取得する
fn get_next_position(conn: &Connection, deck_id: &str) -> Result<i32> {
    let max_pos: Option<i32> = conn.query_row(
        "SELECT MAX(position) FROM columns WHERE deck_id = ?1 AND deleted_at IS NULL",
        params![deck_id],
        |row| row.get(0),
    )?;

    Ok(max_pos.unwrap_or(-1) + 1)
}

/// Column を作成する
pub fn create(conn: &Connection, new_column: NewColumn) -> Result<Column> {
    let id = Ulid::new().to_string();
    let now = Utc::now();
    let position = get_next_position(conn, &new_column.deck_id)?;

    let name = if new_column.name.is_empty() {
        generate_column_name(conn, &new_column.deck_id)?
    } else {
        new_column.name
    };

    conn.execute(
        "INSERT INTO columns (id, deck_id, name, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            &id,
            &new_column.deck_id,
            &name,
            position,
            now.to_rfc3339(),
            now.to_rfc3339(),
        ],
    )?;

    Ok(Column {
        id,
        deck_id: new_column.deck_id,
        name,
        position,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    })
}

/// 特定の位置に Column を作成する
pub fn create_at_position(conn: &Connection, new_column: NewColumn, position: i32) -> Result<Column> {
    let id = Ulid::new().to_string();
    let now = Utc::now();

    let name = if new_column.name.is_empty() {
        generate_column_name(conn, &new_column.deck_id)?
    } else {
        new_column.name
    };

    let tx = conn.unchecked_transaction()?;

    // 挿入位置以降の Column の position を +1 する
    tx.execute(
        "UPDATE columns SET position = position + 1, updated_at = ?1 WHERE deck_id = ?2 AND position >= ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), &new_column.deck_id, position],
    )?;

    tx.execute(
        "INSERT INTO columns (id, deck_id, name, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            &id,
            &new_column.deck_id,
            &name,
            position,
            now.to_rfc3339(),
            now.to_rfc3339(),
        ],
    )?;

    tx.commit()?;

    Ok(Column {
        id,
        deck_id: new_column.deck_id,
        name,
        position,
        created_at: now,
        updated_at: now,
        deleted_at: None,
    })
}

fn row_to_column(row: &rusqlite::Row) -> rusqlite::Result<Column> {
    let deleted_at_str: Option<String> = row.get(6)?;

    Ok(Column {
        id: row.get(0)?,
        deck_id: row.get(1)?,
        name: row.get(2)?,
        position: row.get(3)?,
        created_at: parse_datetime(&row.get::<_, String>(4)?, 4)?,
        updated_at: parse_datetime(&row.get::<_, String>(5)?, 5)?,
        deleted_at: deleted_at_str.and_then(|s| parse_datetime_opt(&s)),
    })
}

/// ID で Column を取得する
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Column> {
    conn.query_row(
        "SELECT id, deck_id, name, position, created_at, updated_at, deleted_at FROM columns WHERE id = ?1",
        params![id],
        row_to_column,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            JotDeckError::NotFound(format!("Column not found: {}", id))
        }
        _ => JotDeckError::Database(e),
    })
}

/// Deck 内の Column 一覧を取得する（削除されていないもののみ）
pub fn get_by_deck_id(conn: &Connection, deck_id: &str) -> Result<Vec<Column>> {
    let mut stmt = conn.prepare(
        "SELECT id, deck_id, name, position, created_at, updated_at, deleted_at FROM columns WHERE deck_id = ?1 AND deleted_at IS NULL ORDER BY position ASC",
    )?;

    let columns = stmt
        .query_map(params![deck_id], row_to_column)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(columns)
}

/// Column を更新する
pub fn update(conn: &Connection, id: &str, name: Option<&str>) -> Result<Column> {
    let column = get_by_id(conn, id)?;

    if column.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Cannot update deleted column".to_string(),
        ));
    }

    let now = Utc::now();
    let new_name = name.unwrap_or(&column.name);

    conn.execute(
        "UPDATE columns SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_name, now.to_rfc3339(), id],
    )?;

    Ok(Column {
        id: column.id,
        deck_id: column.deck_id,
        name: new_name.to_string(),
        position: column.position,
        created_at: column.created_at,
        updated_at: now,
        deleted_at: None,
    })
}

/// Column を移動する（並び替え）
pub fn move_to_position(conn: &Connection, id: &str, new_position: i32) -> Result<Column> {
    let column = get_by_id(conn, id)?;

    if column.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Cannot move deleted column".to_string(),
        ));
    }

    let old_position = column.position;
    let now = Utc::now();

    let tx = conn.unchecked_transaction()?;

    if new_position > old_position {
        // 下に移動: old_position < x <= new_position の Column を -1
        tx.execute(
            "UPDATE columns SET position = position - 1, updated_at = ?1 WHERE deck_id = ?2 AND position > ?3 AND position <= ?4 AND deleted_at IS NULL",
            params![now.to_rfc3339(), &column.deck_id, old_position, new_position],
        )?;
    } else if new_position < old_position {
        // 上に移動: new_position <= x < old_position の Column を +1
        tx.execute(
            "UPDATE columns SET position = position + 1, updated_at = ?1 WHERE deck_id = ?2 AND position >= ?3 AND position < ?4 AND deleted_at IS NULL",
            params![now.to_rfc3339(), &column.deck_id, new_position, old_position],
        )?;
    }

    tx.execute(
        "UPDATE columns SET position = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_position, now.to_rfc3339(), id],
    )?;

    tx.commit()?;

    Ok(Column {
        position: new_position,
        updated_at: now,
        ..column
    })
}

/// Column を論理削除する（所属する Card も連動して論理削除）
pub fn soft_delete(conn: &Connection, id: &str) -> Result<()> {
    let column = get_by_id(conn, id)?;

    if column.deleted_at.is_some() {
        return Err(JotDeckError::InvalidOperation(
            "Column is already deleted".to_string(),
        ));
    }

    let now = Utc::now();

    let tx = conn.unchecked_transaction()?;

    // 所属する Card を連動削除
    tx.execute(
        "UPDATE cards SET deleted_at = ?1, deleted_with_column = 1, updated_at = ?1 WHERE column_id = ?2 AND deleted_at IS NULL",
        params![now.to_rfc3339(), id],
    )?;

    // Column を論理削除
    tx.execute(
        "UPDATE columns SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now.to_rfc3339(), id],
    )?;

    // position を詰める
    tx.execute(
        "UPDATE columns SET position = position - 1, updated_at = ?1 WHERE deck_id = ?2 AND position > ?3 AND deleted_at IS NULL",
        params![now.to_rfc3339(), &column.deck_id, column.position],
    )?;

    tx.commit()?;

    Ok(())
}

/// Column を復元する（連動削除された Card も復元）
pub fn restore(conn: &Connection, id: &str) -> Result<Column> {
    let column = get_by_id(conn, id)?;

    if column.deleted_at.is_none() {
        return Err(JotDeckError::InvalidOperation(
            "Column is not deleted".to_string(),
        ));
    }

    let now = Utc::now();
    let new_position = get_next_position(conn, &column.deck_id)?;

    let tx = conn.unchecked_transaction()?;

    // 連動削除された Card を復元
    tx.execute(
        "UPDATE cards SET deleted_at = NULL, deleted_with_column = 0, updated_at = ?1 WHERE column_id = ?2 AND deleted_with_column = 1",
        params![now.to_rfc3339(), id],
    )?;

    // Column を復元
    tx.execute(
        "UPDATE columns SET deleted_at = NULL, position = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_position, now.to_rfc3339(), id],
    )?;

    tx.commit()?;

    Ok(Column {
        deleted_at: None,
        position: new_position,
        updated_at: now,
        ..column
    })
}

/// 削除済みの Column 一覧を取得する（ゴミ箱表示用）
pub fn get_deleted(conn: &Connection, deck_id: &str) -> Result<Vec<Column>> {
    let mut stmt = conn.prepare(
        "SELECT id, deck_id, name, position, created_at, updated_at, deleted_at FROM columns WHERE deck_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )?;

    let columns = stmt
        .query_map(params![deck_id], row_to_column)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(columns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewDeck, SortOrder};
    use crate::repository::deck;

    fn setup() -> (Connection, String) {
        let conn = create_in_memory().unwrap();
        let deck = deck::create(
            &conn,
            NewDeck {
                name: "Test Deck".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();
        (conn, deck.id)
    }

    #[test]
    fn test_create_column() {
        let (conn, deck_id) = setup();

        let column = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "".to_string(),
            },
        )
        .unwrap();

        assert_eq!(column.name, "a-col");
        assert_eq!(column.position, 0);
    }

    #[test]
    fn test_auto_naming() {
        let (conn, deck_id) = setup();

        let col1 = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "".to_string(),
            },
        )
        .unwrap();
        let col2 = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "".to_string(),
            },
        )
        .unwrap();
        let col3 = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "".to_string(),
            },
        )
        .unwrap();

        assert_eq!(col1.name, "a-col");
        assert_eq!(col2.name, "b-col");
        assert_eq!(col3.name, "c-col");
    }

    #[test]
    fn test_soft_delete_and_restore() {
        let (conn, deck_id) = setup();

        let column = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "Test Column".to_string(),
            },
        )
        .unwrap();

        soft_delete(&conn, &column.id).unwrap();

        let deleted = get_by_id(&conn, &column.id).unwrap();
        assert!(deleted.deleted_at.is_some());

        let columns = get_by_deck_id(&conn, &deck_id).unwrap();
        assert!(columns.is_empty());

        let restored = restore(&conn, &column.id).unwrap();
        assert!(restored.deleted_at.is_none());

        let columns = get_by_deck_id(&conn, &deck_id).unwrap();
        assert_eq!(columns.len(), 1);
    }

    #[test]
    fn test_move_column() {
        let (conn, deck_id) = setup();

        let col1 = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "A".to_string(),
            },
        )
        .unwrap();
        let _col2 = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "B".to_string(),
            },
        )
        .unwrap();
        let _col3 = create(
            &conn,
            NewColumn {
                deck_id: deck_id.clone(),
                name: "C".to_string(),
            },
        )
        .unwrap();

        // col1 を position 2 に移動 (A, B, C) -> (B, C, A)
        move_to_position(&conn, &col1.id, 2).unwrap();

        let columns = get_by_deck_id(&conn, &deck_id).unwrap();
        assert_eq!(columns[0].name, "B");
        assert_eq!(columns[1].name, "C");
        assert_eq!(columns[2].name, "A");
    }

    #[test]
    fn test_to_alphabetic() {
        // Single letter: a-z (0-25)
        assert_eq!(to_alphabetic(0), "a");
        assert_eq!(to_alphabetic(1), "b");
        assert_eq!(to_alphabetic(25), "z");

        // Two letters: aa-zz (26-701)
        assert_eq!(to_alphabetic(26), "aa");
        assert_eq!(to_alphabetic(27), "ab");
        assert_eq!(to_alphabetic(51), "az");
        assert_eq!(to_alphabetic(52), "ba");
        assert_eq!(to_alphabetic(701), "zz");

        // Three letters: aaa-zzz (702-18277)
        assert_eq!(to_alphabetic(702), "aaa");
        assert_eq!(to_alphabetic(703), "aab");
        assert_eq!(to_alphabetic(18277), "zzz");

        // Four letters (18278+)
        assert_eq!(to_alphabetic(18278), "aaaa");
    }
}
