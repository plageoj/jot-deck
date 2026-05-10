use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::Result;

pub const APP_SETTINGS_KEY: &str = "app";

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
}
