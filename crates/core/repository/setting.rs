use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::Result;

pub const APP_SETTINGS_KEY: &str = "app";
/// GUI が Deck を切り替えるたびに書き込む「直近アクティブ Deck」のキー。値は
/// Deck ULID の JSON 文字列。MCP ブリッジが `deck_id` 省略時の既定値として読む
/// （008-mcp-server.md §4.5）。
pub const ACTIVE_DECK_KEY: &str = "active_deck_id";

/// 指定キーの設定値（JSON 文字列）を取得する。未保存の場合は `None`。
pub fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// 指定キーの設定値（JSON 文字列）を upsert する。
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

/// GUI の直近アクティブ Deck ID を取得する。未保存・不正な値なら `None`。
pub fn get_active_deck_id(conn: &Connection) -> Result<Option<String>> {
    Ok(get(conn, ACTIVE_DECK_KEY)?
        .and_then(|raw| serde_json::from_str::<String>(&raw).ok())
        .filter(|id| !id.is_empty()))
}

/// GUI の直近アクティブ Deck ID を保存する。
pub fn set_active_deck_id(conn: &Connection, deck_id: &str) -> Result<()> {
    let value = serde_json::to_string(deck_id).expect("serializing a string cannot fail");
    set(conn, ACTIVE_DECK_KEY, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;

    #[test]
    fn returns_none_when_unset() {
        let conn = create_in_memory().unwrap();
        assert_eq!(get(&conn, APP_SETTINGS_KEY).unwrap(), None);
    }

    #[test]
    fn upserts_value() {
        let conn = create_in_memory().unwrap();
        set(&conn, APP_SETTINGS_KEY, "{\"theme\":\"dark\"}").unwrap();
        assert_eq!(
            get(&conn, APP_SETTINGS_KEY).unwrap(),
            Some("{\"theme\":\"dark\"}".to_string())
        );

        set(&conn, APP_SETTINGS_KEY, "{\"theme\":\"light\"}").unwrap();
        assert_eq!(
            get(&conn, APP_SETTINGS_KEY).unwrap(),
            Some("{\"theme\":\"light\"}".to_string())
        );
    }

    #[test]
    fn isolates_keys() {
        let conn = create_in_memory().unwrap();
        set(&conn, "alpha", "1").unwrap();
        set(&conn, "beta", "2").unwrap();
        assert_eq!(get(&conn, "alpha").unwrap(), Some("1".to_string()));
        assert_eq!(get(&conn, "beta").unwrap(), Some("2".to_string()));
    }

    #[test]
    fn active_deck_id_round_trips_as_json_string() {
        let conn = create_in_memory().unwrap();
        assert_eq!(get_active_deck_id(&conn).unwrap(), None);
        set_active_deck_id(&conn, "01DECK").unwrap();
        assert_eq!(get(&conn, ACTIVE_DECK_KEY).unwrap(), Some("\"01DECK\"".to_string()));
        assert_eq!(get_active_deck_id(&conn).unwrap(), Some("01DECK".to_string()));
    }

    #[test]
    fn malformed_active_deck_id_is_ignored() {
        let conn = create_in_memory().unwrap();
        set(&conn, ACTIVE_DECK_KEY, "not json").unwrap();
        assert_eq!(get_active_deck_id(&conn).unwrap(), None);
    }
}
