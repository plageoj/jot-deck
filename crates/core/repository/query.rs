//! Deck-scoped read queries backing the MCP read surface (008-mcp-server.md §4.2).
//!
//! Every function is fixed to a single connection Deck and enforces read
//! visibility in SQL — deleted and `private` columns (and their cards) are never
//! returned. This is the trust boundary: the MCP bridge is an untrusted helper
//! process, so filtering lives here in the core repository, not in the bridge
//! (008-mcp-server.md §4.5).

use chrono::{DateTime, Utc};
use rusqlite::types::Value;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{JotDeckError, Result};
use crate::repository::{deck, tag};

/// `search_cards` / `recent_cards` の既定取得件数（008-mcp-server.md §4.2）。
pub const DEFAULT_QUERY_LIMIT: usize = 20;
/// `limit` の上限。暴走した大量取得を抑える backstop。
pub const MAX_QUERY_LIMIT: usize = 100;
/// 1 カードの最大文字数 backstop（008-mcp-server.md §5）。describe_deck が公開する。
pub const MAX_CARD_LENGTH: usize = 4000;
/// タグ記法の 1 行説明（describe_deck 用）。
pub const TAG_SYNTAX: &str = "#word (word: letters, digits, underscore, Japanese)";

/// カラム構成の要約（`list_columns` / `describe_deck`）。
#[derive(Debug, Clone, Serialize)]
pub struct ColumnSummary {
    pub column_id: String,
    pub name: String,
    pub description: Option<String>,
    pub position: i32,
    pub card_count: i64,
}

/// 単体カードの詳細（`read_card`）。
#[derive(Debug, Clone, Serialize)]
pub struct CardDetail {
    pub card_id: String,
    pub column_id: String,
    pub content: String,
    pub score: i32,
    pub tags: Vec<String>,
    pub position: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// 検索・直近取得の結果行（`search_cards` / `recent_cards`）。
#[derive(Debug, Clone, Serialize)]
pub struct CardSummary {
    pub card_id: String,
    pub column_id: String,
    pub content: String,
    pub score: i32,
    pub tags: Vec<String>,
    pub created_at: String,
}

/// 接続 Deck の実行時実体と制約（`describe_deck` / `deck://schema`）。
#[derive(Debug, Clone, Serialize)]
pub struct DeckDescription {
    pub deck_id: String,
    pub deck_name: String,
    pub columns: Vec<ColumnSummary>,
    pub constraints: Constraints,
}

/// エージェントが従うべき制約値。error による誘導と同じ内容を先出しする。
#[derive(Debug, Clone, Serialize)]
pub struct Constraints {
    pub max_card_length: usize,
    pub default_query_limit: usize,
    pub max_query_limit: usize,
    pub tag_syntax: String,
}

impl Default for Constraints {
    fn default() -> Self {
        Self {
            max_card_length: MAX_CARD_LENGTH,
            default_query_limit: DEFAULT_QUERY_LIMIT,
            max_query_limit: MAX_QUERY_LIMIT,
            tag_syntax: TAG_SYNTAX.to_string(),
        }
    }
}

/// 検索パラメータ（`search_cards`）。
#[derive(Debug, Default, Clone)]
pub struct SearchParams {
    /// 本文の部分一致クエリ。FTS5 全文検索は Phase 9 で導入予定のため、当面は
    /// LIKE ベース。空/None なら本文条件なし。
    pub query: Option<String>,
    /// カラム絞り込み。可視範囲外を指定すると Unauthorized。
    pub column_id: Option<String>,
    /// タグ AND 絞り込み（すべて含むカードのみ）。
    pub tags: Vec<String>,
    /// 最小スコア。
    pub min_score: Option<i32>,
    /// 取得件数。None なら DEFAULT_QUERY_LIMIT、MAX_QUERY_LIMIT で頭打ち。
    pub limit: Option<usize>,
}

fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_QUERY_LIMIT).clamp(1, MAX_QUERY_LIMIT)
}

fn parse_dt(s: &str, idx: usize) -> rusqlite::Result<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(idx, rusqlite::types::Type::Text, Box::new(e))
        })
}

/// LIKE パターン用に `%` `_` `\` をエスケープする。
fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' | '%' | '_' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// カラムが接続 Deck の可視範囲（非削除・非 private）にあるか。存在しない/別 Deck
/// の場合も false。書き込み面（write.rs）も同じ可視性判定を共有する。
pub(crate) fn is_column_visible(conn: &Connection, deck_id: &str, column_id: &str) -> Result<bool> {
    let visible: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM columns
             WHERE id = ?1 AND deck_id = ?2 AND deleted_at IS NULL AND private = 0",
            params![column_id, deck_id],
            |row| row.get(0),
        )
        .ok();
    Ok(visible.is_some())
}

/// Deck の可視カラム一覧（position 昇順、非削除・非 private）を返す。
///
/// read 可視性制御で除外されたカラムは ID すら返さない（008-mcp-server.md §4.5）。
pub fn list_columns(conn: &Connection, deck_id: &str) -> Result<Vec<ColumnSummary>> {
    let mut stmt = conn.prepare(
        "SELECT col.id, col.name, col.description, col.position,
                (SELECT COUNT(*) FROM cards c
                   WHERE c.column_id = col.id AND c.deleted_at IS NULL) AS card_count
         FROM columns col
         WHERE col.deck_id = ?1 AND col.deleted_at IS NULL AND col.private = 0
         ORDER BY col.position ASC",
    )?;

    let rows = stmt
        .query_map(params![deck_id], |row| {
            Ok(ColumnSummary {
                column_id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                position: row.get(3)?,
                card_count: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(rows)
}

/// カードを ID 取得する。可視範囲外・削除済み・別 Deck のカードは存在を漏らさない
/// ため NotFound を返す（008-mcp-server.md §4.5）。
pub fn read_card(conn: &Connection, deck_id: &str, card_id: &str) -> Result<CardDetail> {
    let detail = conn
        .query_row(
            "SELECT c.id, c.column_id, c.content, c.score, c.position, c.created_at, c.updated_at
             FROM cards c
             JOIN columns col ON c.column_id = col.id
             WHERE c.id = ?1 AND col.deck_id = ?2
               AND c.deleted_at IS NULL AND col.deleted_at IS NULL AND col.private = 0",
            params![card_id, deck_id],
            |row| {
                Ok(CardDetail {
                    card_id: row.get(0)?,
                    column_id: row.get(1)?,
                    content: row.get(2)?,
                    score: row.get(3)?,
                    tags: Vec::new(),
                    position: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?, 5)?.to_rfc3339(),
                    updated_at: parse_dt(&row.get::<_, String>(6)?, 6)?.to_rfc3339(),
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                JotDeckError::NotFound(format!("Card not found: {}", card_id))
            }
            _ => JotDeckError::Database(e),
        })?;

    let tags = tag::get_tags_by_card(conn, &detail.card_id)?
        .into_iter()
        .map(|t| t.name)
        .collect();

    Ok(CardDetail { tags, ..detail })
}

/// FTS + タグ/スコア/カラムでカードを検索する（008-mcp-server.md §4.2）。
///
/// 全文検索（Phase 9）が入るまでは本文の LIKE 部分一致。可視範囲外カラムを
/// `column_id` で明示指定した場合は空ではなく Unauthorized を返す。
pub fn search_cards(
    conn: &Connection,
    deck_id: &str,
    params_in: &SearchParams,
) -> Result<Vec<CardSummary>> {
    if let Some(col) = &params_in.column_id {
        if !is_column_visible(conn, deck_id, col)? {
            return Err(JotDeckError::Unauthorized(format!(
                "Column not accessible: {}",
                col
            )));
        }
    }

    let limit = clamp_limit(params_in.limit);
    let mut sql = String::from(
        "SELECT c.id, c.column_id, c.content, c.score, c.created_at
         FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE col.deck_id = ?1 AND c.deleted_at IS NULL
           AND col.deleted_at IS NULL AND col.private = 0",
    );
    let mut args: Vec<Value> = vec![Value::Text(deck_id.to_string())];

    if let Some(q) = params_in.query.as_deref().filter(|s| !s.is_empty()) {
        args.push(Value::Text(format!("%{}%", escape_like(q))));
        sql.push_str(&format!(" AND c.content LIKE ?{} ESCAPE '\\'", args.len()));
    }
    if let Some(col) = &params_in.column_id {
        args.push(Value::Text(col.clone()));
        sql.push_str(&format!(" AND c.column_id = ?{}", args.len()));
    }
    if let Some(min) = params_in.min_score {
        args.push(Value::Integer(min as i64));
        sql.push_str(&format!(" AND c.score >= ?{}", args.len()));
    }
    let clean_tags: Vec<&String> = params_in.tags.iter().filter(|t| !t.is_empty()).collect();
    if !clean_tags.is_empty() {
        let placeholders: Vec<String> = clean_tags
            .iter()
            .map(|t| {
                args.push(Value::Text((*t).clone()));
                format!("?{}", args.len())
            })
            .collect();
        args.push(Value::Integer(clean_tags.len() as i64));
        let count_idx = args.len();
        sql.push_str(&format!(
            " AND c.id IN (
                SELECT ct.card_id FROM card_tags ct JOIN tags t ON ct.tag_id = t.id
                WHERE t.name IN ({}) GROUP BY ct.card_id
                HAVING COUNT(DISTINCT t.name) = ?{})",
            placeholders.join(", "),
            count_idx,
        ));
    }

    sql.push_str(" ORDER BY c.score DESC, c.created_at DESC");
    args.push(Value::Integer(limit as i64));
    sql.push_str(&format!(" LIMIT ?{}", args.len()));

    run_summary_query(conn, &sql, args)
}

/// クエリ無しでカラム（または Deck 全体）の直近カードを取得する。
pub fn recent_cards(
    conn: &Connection,
    deck_id: &str,
    column_id: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<CardSummary>> {
    if let Some(col) = column_id {
        if !is_column_visible(conn, deck_id, col)? {
            return Err(JotDeckError::Unauthorized(format!(
                "Column not accessible: {}",
                col
            )));
        }
    }

    let limit = clamp_limit(limit);
    let mut sql = String::from(
        "SELECT c.id, c.column_id, c.content, c.score, c.created_at
         FROM cards c
         JOIN columns col ON c.column_id = col.id
         WHERE col.deck_id = ?1 AND c.deleted_at IS NULL
           AND col.deleted_at IS NULL AND col.private = 0",
    );
    let mut args: Vec<Value> = vec![Value::Text(deck_id.to_string())];
    if let Some(col) = column_id {
        args.push(Value::Text(col.to_string()));
        sql.push_str(&format!(" AND c.column_id = ?{}", args.len()));
    }
    sql.push_str(" ORDER BY c.created_at DESC");
    args.push(Value::Integer(limit as i64));
    sql.push_str(&format!(" LIMIT ?{}", args.len()));

    run_summary_query(conn, &sql, args)
}

/// CardSummary を返すクエリを実行し、各行のタグを埋める。
fn run_summary_query(conn: &Connection, sql: &str, args: Vec<Value>) -> Result<Vec<CardSummary>> {
    let mut stmt = conn.prepare(sql)?;
    let mut summaries = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |row| {
            Ok(CardSummary {
                card_id: row.get(0)?,
                column_id: row.get(1)?,
                content: row.get(2)?,
                score: row.get(3)?,
                tags: Vec::new(),
                created_at: parse_dt(&row.get::<_, String>(4)?, 4)?.to_rfc3339(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for s in &mut summaries {
        s.tags = tag::get_tags_by_card(conn, &s.card_id)?
            .into_iter()
            .map(|t| t.name)
            .collect();
    }
    Ok(summaries)
}

/// 接続 Deck の実行時実体（可視カラム）と制約値を 1 回で返す（008-mcp-server.md §4.6）。
pub fn describe_deck(conn: &Connection, deck_id: &str) -> Result<DeckDescription> {
    let d = deck::get_by_id(conn, deck_id)?;
    let columns = list_columns(conn, deck_id)?;
    Ok(DeckDescription {
        deck_id: d.id,
        deck_name: d.name,
        columns,
        constraints: Constraints::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewCard, NewColumn, NewDeck, SortOrder};
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
        column::update(&conn, &public_col.id, None, Some(Some("public notes")), None).unwrap();
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

    fn add_card(f: &Fixture, col: &str, content: &str) -> String {
        card::create(
            &f.conn,
            NewCard {
                column_id: col.to_string(),
                content: content.to_string(),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn list_columns_excludes_private_and_deleted() {
        let f = setup();
        add_card(&f, &f.public_col, "hello");

        let cols = list_columns(&f.conn, &f.deck_id).unwrap();
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "Public");
        assert_eq!(cols[0].description.as_deref(), Some("public notes"));
        assert_eq!(cols[0].card_count, 1);
    }

    #[test]
    fn read_card_hides_private_column_cards() {
        let f = setup();
        let public_card = add_card(&f, &f.public_col, "visible");
        let private_card = add_card(&f, &f.private_col, "hidden");

        let got = read_card(&f.conn, &f.deck_id, &public_card).unwrap();
        assert_eq!(got.content, "visible");

        // private カラムのカードは存在を漏らさず NotFound
        let err = read_card(&f.conn, &f.deck_id, &private_card).unwrap_err();
        assert!(matches!(err, JotDeckError::NotFound(_)));
    }

    #[test]
    fn search_filters_by_query_tag_and_score() {
        let f = setup();
        let c1 = add_card(&f, &f.public_col, "rust #lang notes");
        add_card(&f, &f.public_col, "python scripting");
        card::update_score(&f.conn, &c1, 3).unwrap();

        let by_text = search_cards(
            &f.conn,
            &f.deck_id,
            &SearchParams {
                query: Some("rust".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_text.len(), 1);
        assert!(by_text[0].tags.contains(&"lang".to_string()));

        let by_tag = search_cards(
            &f.conn,
            &f.deck_id,
            &SearchParams {
                tags: vec!["lang".to_string()],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_tag.len(), 1);

        let by_score = search_cards(
            &f.conn,
            &f.deck_id,
            &SearchParams {
                min_score: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_score.len(), 1);
        assert_eq!(by_score[0].card_id, c1);
    }

    #[test]
    fn search_excludes_private_column_cards() {
        let f = setup();
        add_card(&f, &f.public_col, "shared secret plan");
        add_card(&f, &f.private_col, "top secret plan");

        let results = search_cards(
            &f.conn,
            &f.deck_id,
            &SearchParams {
                query: Some("secret".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "shared secret plan");
    }

    #[test]
    fn search_explicit_private_column_is_unauthorized() {
        let f = setup();
        let err = search_cards(
            &f.conn,
            &f.deck_id,
            &SearchParams {
                column_id: Some(f.private_col.clone()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, JotDeckError::Unauthorized(_)));
    }

    #[test]
    fn recent_cards_orders_by_created_desc() {
        let f = setup();
        let _first = add_card(&f, &f.public_col, "oldest");
        let last = add_card(&f, &f.public_col, "newest");

        let recent = recent_cards(&f.conn, &f.deck_id, Some(&f.public_col), Some(10)).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].card_id, last);
    }

    #[test]
    fn limit_is_clamped_to_max() {
        assert_eq!(clamp_limit(None), DEFAULT_QUERY_LIMIT);
        assert_eq!(clamp_limit(Some(0)), 1);
        assert_eq!(clamp_limit(Some(9999)), MAX_QUERY_LIMIT);
    }

    #[test]
    fn describe_deck_reports_columns_and_constraints() {
        let f = setup();
        let desc = describe_deck(&f.conn, &f.deck_id).unwrap();
        assert_eq!(desc.deck_name, "KB");
        assert_eq!(desc.columns.len(), 1); // private 除外
        assert_eq!(desc.constraints.max_query_limit, MAX_QUERY_LIMIT);
    }
}
