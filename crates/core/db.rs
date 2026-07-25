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
    description TEXT,
    private INTEGER NOT NULL DEFAULT 0,
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
    locked_by TEXT,
    locked_at TEXT,
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

-- Settings テーブル（アプリ全体の設定を JSON で保持。将来のクラウド同期に備えて key/value 形式）
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

/// データベースを初期化する
pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute("PRAGMA foreign_keys = ON", [])?;
    conn.execute_batch(SCHEMA)?;
    migrate(conn)?;
    Ok(())
}

/// 既存 DB を最新スキーマへ移行する（冪等）。
///
/// SQLite は `ADD COLUMN IF NOT EXISTS` を持たないため、`PRAGMA table_info`
/// で列の有無を確認してから `ALTER TABLE` する。新規 DB では `SCHEMA` が既に
/// 最新なので何もしない。
fn migrate(conn: &Connection) -> Result<()> {
    // columns.description / columns.private（008-mcp-server.md §4.5 / 002 §1.2）
    if !column_exists(conn, "columns", "description")? {
        add_column_ignoring_duplicate(conn, "ALTER TABLE columns ADD COLUMN description TEXT")?;
    }
    if !column_exists(conn, "columns", "private")? {
        add_column_ignoring_duplicate(
            conn,
            "ALTER TABLE columns ADD COLUMN private INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    // cards.locked_by / cards.locked_at（002 §5 カード編集の競合制御）
    if !column_exists(conn, "cards", "locked_by")? {
        add_column_ignoring_duplicate(conn, "ALTER TABLE cards ADD COLUMN locked_by TEXT")?;
    }
    if !column_exists(conn, "cards", "locked_at")? {
        add_column_ignoring_duplicate(conn, "ALTER TABLE cards ADD COLUMN locked_at TEXT")?;
    }
    Ok(())
}

/// `ALTER TABLE ... ADD COLUMN` を実行し、SQLite の "duplicate column name"
/// を成功として扱う。
///
/// GUI・CLI・MCP が同一ファイルを同時に開くと（`create_file_db` 参照）、両者が
/// 列の欠落を観測してから `ALTER TABLE` を競合実行しうる。負けた側は
/// "duplicate column name" で失敗するが、これは既に列が追加された証左なので
/// 起動を止めるべきではない。
fn add_column_ignoring_duplicate(conn: &Connection, sql: &str) -> Result<()> {
    match conn.execute_batch(sql) {
        Ok(()) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
            if msg.contains("duplicate column name") =>
        {
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// テーブルに指定した列が存在するか。
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let found = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .any(|name| name == column);
    Ok(found)
}

/// インメモリデータベースを作成する（テスト用）
pub fn create_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    init_db(&conn)?;
    Ok(conn)
}

/// ファイルベースのデータベースを作成する。
///
/// GUI・CLI・MCP ブリッジが同一ファイルを同時に開けるよう、WAL モードと
/// busy_timeout を有効化する（008-mcp-server.md §3）。WAL は接続ごとではなく
/// DB ファイルの永続属性なので、最初に開いたプロセスが設定すれば以降も維持される。
pub fn create_file_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    // 他プロセスの書き込みロックと競合したときに即エラーにせず待機する。
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    // WAL: 読み手（MCP ブリッジ）が書き手（GUI）をブロックせず同時に開ける。
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
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
        assert!(tables.contains(&"settings".to_string()));
    }

    #[test]
    fn test_columns_have_private_and_description() {
        let conn = create_in_memory().unwrap();
        assert!(column_exists(&conn, "columns", "private").unwrap());
        assert!(column_exists(&conn, "columns", "description").unwrap());
    }

    #[test]
    fn test_cards_have_lock_columns() {
        let conn = create_in_memory().unwrap();
        assert!(column_exists(&conn, "cards", "locked_by").unwrap());
        assert!(column_exists(&conn, "cards", "locked_at").unwrap());
    }

    #[test]
    fn test_migration_adds_lock_columns_to_legacy_cards() {
        // locked_by / locked_at を持たない旧 cards スキーマを再現する。
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE cards (
                id TEXT PRIMARY KEY,
                column_id TEXT NOT NULL,
                content TEXT NOT NULL,
                score INTEGER NOT NULL DEFAULT 0,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                deleted_with_column INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        assert!(!column_exists(&conn, "cards", "locked_by").unwrap());

        init_db(&conn).unwrap();
        assert!(column_exists(&conn, "cards", "locked_by").unwrap());
        assert!(column_exists(&conn, "cards", "locked_at").unwrap());

        // 冪等。
        init_db(&conn).unwrap();
    }

    #[test]
    fn test_migration_adds_columns_to_legacy_schema() {
        // private / description を持たない旧スキーマを再現する。
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE columns (
                id TEXT PRIMARY KEY,
                deck_id TEXT NOT NULL,
                name TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );",
        )
        .unwrap();
        assert!(!column_exists(&conn, "columns", "private").unwrap());

        // init_db (→ migrate) が冪等に列を追加する。
        init_db(&conn).unwrap();
        assert!(column_exists(&conn, "columns", "private").unwrap());
        assert!(column_exists(&conn, "columns", "description").unwrap());

        // 二度目の init_db でも失敗しない（冪等）。
        init_db(&conn).unwrap();
    }

    #[test]
    fn test_add_column_ignoring_duplicate_tolerates_race_loser() {
        // 同時起動レースの敗者が観測する "duplicate column name" を再現する:
        // 既に存在する列への ADD COLUMN はエラーではなく成功として扱う。
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE columns (id TEXT PRIMARY KEY, private INTEGER)")
            .unwrap();
        // 直接 ALTER すれば "duplicate column name" になる状況。
        assert!(conn
            .execute_batch("ALTER TABLE columns ADD COLUMN private INTEGER")
            .is_err());
        // ヘルパーはそれを飲み込む。
        add_column_ignoring_duplicate(&conn, "ALTER TABLE columns ADD COLUMN private INTEGER")
            .unwrap();
    }

    #[test]
    fn test_file_db_uses_wal() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("jot-deck-test-wal-{}.db", std::process::id()));
        let path_str = path.to_str().unwrap();
        {
            let conn = create_file_db(path_str).unwrap();
            let mode: String = conn
                .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                .unwrap();
            assert_eq!(mode.to_lowercase(), "wal");
        }
        // WAL 補助ファイルも含めて後始末する。
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path_str));
        let _ = std::fs::remove_file(format!("{}-shm", path_str));
    }
}
