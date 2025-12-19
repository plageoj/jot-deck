use rusqlite::Connection;

use crate::error::Result;

const SCHEMA: &str = r#"
-- Deck テーブル
CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order TEXT NOT NULL DEFAULT 'created_desc',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Column テーブル
CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (deck_id) REFERENCES decks(id)
);

-- Column インデックス
CREATE INDEX IF NOT EXISTS idx_columns_deck_id ON columns(deck_id);
CREATE INDEX IF NOT EXISTS idx_columns_deleted_at ON columns(deleted_at);

-- Card テーブル
CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL,
    content TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    deleted_with_column INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (column_id) REFERENCES columns(id)
);

-- Card インデックス
CREATE INDEX IF NOT EXISTS idx_cards_column_id ON cards(column_id);
CREATE INDEX IF NOT EXISTS idx_cards_deleted_at ON cards(deleted_at);

-- Tag テーブル
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- Card-Tag 関連テーブル
CREATE TABLE IF NOT EXISTS card_tags (
    card_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (card_id, tag_id),
    FOREIGN KEY (card_id) REFERENCES cards(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE INDEX IF NOT EXISTS idx_card_tags_tag_id ON card_tags(tag_id);
"#;

/// データベースを初期化する
pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    Ok(())
}

/// インメモリデータベースを作成する（テスト用）
pub fn create_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    init_db(&conn)?;
    Ok(conn)
}

/// ファイルベースのデータベースを作成する
pub fn create_file_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    init_db(&conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_db() {
        let conn = create_in_memory().unwrap();

        // テーブルが作成されたことを確認
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"decks".to_string()));
        assert!(tables.contains(&"columns".to_string()));
        assert!(tables.contains(&"cards".to_string()));
        assert!(tables.contains(&"tags".to_string()));
        assert!(tables.contains(&"card_tags".to_string()));
    }
}
