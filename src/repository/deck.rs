use chrono::Utc;
use rusqlite::{params, Connection};
use ulid::Ulid;

use crate::error::{JotDeckError, Result};
use crate::models::{Deck, NewDeck, SortOrder};

/// Deck を作成する
pub fn create(conn: &Connection, new_deck: NewDeck) -> Result<Deck> {
    let id = Ulid::new().to_string();
    let now = Utc::now();

    conn.execute(
        "INSERT INTO decks (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            &id,
            &new_deck.name,
            new_deck.sort_order.to_db_value(),
            now.to_rfc3339(),
            now.to_rfc3339(),
        ],
    )?;

    Ok(Deck {
        id,
        name: new_deck.name,
        sort_order: new_deck.sort_order,
        created_at: now,
        updated_at: now,
    })
}

/// ID で Deck を取得する
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Deck> {
    conn.query_row(
        "SELECT id, name, sort_order, created_at, updated_at FROM decks WHERE id = ?1",
        params![id],
        |row| {
            Ok(Deck {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: SortOrder::from_db_value(&row.get::<_, String>(2)?),
                created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(3)?)
                    .unwrap()
                    .with_timezone(&Utc),
                updated_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                    .unwrap()
                    .with_timezone(&Utc),
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            JotDeckError::NotFound(format!("Deck not found: {}", id))
        }
        _ => JotDeckError::Database(e),
    })
}

/// すべての Deck を取得する
pub fn get_all(conn: &Connection) -> Result<Vec<Deck>> {
    let mut stmt =
        conn.prepare("SELECT id, name, sort_order, created_at, updated_at FROM decks ORDER BY created_at DESC")?;

    let decks = stmt
        .query_map([], |row| {
            Ok(Deck {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: SortOrder::from_db_value(&row.get::<_, String>(2)?),
                created_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(3)?)
                    .unwrap()
                    .with_timezone(&Utc),
                updated_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                    .unwrap()
                    .with_timezone(&Utc),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(decks)
}

/// Deck を更新する
pub fn update(conn: &Connection, id: &str, name: Option<&str>, sort_order: Option<SortOrder>) -> Result<Deck> {
    let deck = get_by_id(conn, id)?;
    let now = Utc::now();

    let new_name = name.unwrap_or(&deck.name);
    let new_sort_order = sort_order.unwrap_or(deck.sort_order);

    conn.execute(
        "UPDATE decks SET name = ?1, sort_order = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_name, new_sort_order.to_db_value(), now.to_rfc3339(), id],
    )?;

    Ok(Deck {
        id: deck.id,
        name: new_name.to_string(),
        sort_order: new_sort_order,
        created_at: deck.created_at,
        updated_at: now,
    })
}

/// Deck を削除する（物理削除）
/// 注意: 関連する Column と Card も削除される
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    // まず Deck が存在するか確認
    let _ = get_by_id(conn, id)?;

    // 関連する Card を削除
    conn.execute(
        "DELETE FROM cards WHERE column_id IN (SELECT id FROM columns WHERE deck_id = ?1)",
        params![id],
    )?;

    // 関連する Column を削除
    conn.execute("DELETE FROM columns WHERE deck_id = ?1", params![id])?;

    // Deck を削除
    conn.execute("DELETE FROM decks WHERE id = ?1", params![id])?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;

    #[test]
    fn test_create_deck() {
        let conn = create_in_memory().unwrap();

        let new_deck = NewDeck {
            name: "My Deck".to_string(),
            sort_order: SortOrder::default(),
        };

        let deck = create(&conn, new_deck).unwrap();

        assert_eq!(deck.name, "My Deck");
        assert_eq!(deck.sort_order, SortOrder::CreatedDesc);
    }

    #[test]
    fn test_get_deck_by_id() {
        let conn = create_in_memory().unwrap();

        let new_deck = NewDeck {
            name: "My Deck".to_string(),
            sort_order: SortOrder::default(),
        };

        let created = create(&conn, new_deck).unwrap();
        let fetched = get_by_id(&conn, &created.id).unwrap();

        assert_eq!(created.id, fetched.id);
        assert_eq!(created.name, fetched.name);
    }

    #[test]
    fn test_get_deck_not_found() {
        let conn = create_in_memory().unwrap();

        let result = get_by_id(&conn, "nonexistent");

        assert!(matches!(result, Err(JotDeckError::NotFound(_))));
    }

    #[test]
    fn test_update_deck() {
        let conn = create_in_memory().unwrap();

        let new_deck = NewDeck {
            name: "My Deck".to_string(),
            sort_order: SortOrder::default(),
        };

        let deck = create(&conn, new_deck).unwrap();
        let updated = update(&conn, &deck.id, Some("Updated Deck"), Some(SortOrder::ScoreDesc)).unwrap();

        assert_eq!(updated.name, "Updated Deck");
        assert_eq!(updated.sort_order, SortOrder::ScoreDesc);
    }

    #[test]
    fn test_delete_deck() {
        let conn = create_in_memory().unwrap();

        let new_deck = NewDeck {
            name: "My Deck".to_string(),
            sort_order: SortOrder::default(),
        };

        let deck = create(&conn, new_deck).unwrap();
        delete(&conn, &deck.id).unwrap();

        let result = get_by_id(&conn, &deck.id);
        assert!(matches!(result, Err(JotDeckError::NotFound(_))));
    }

    #[test]
    fn test_get_all_decks() {
        let conn = create_in_memory().unwrap();

        create(
            &conn,
            NewDeck {
                name: "Deck 1".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();

        create(
            &conn,
            NewDeck {
                name: "Deck 2".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();

        let decks = get_all(&conn).unwrap();
        assert_eq!(decks.len(), 2);
    }
}
