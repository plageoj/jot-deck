//! Change history of external writes (008-mcp-server.md §5.1).
//!
//! Every mutation that goes through `jot_deck_core::write` (the MCP bridge and
//! the Reporter host) records one row here in the same transaction as the
//! write: the target, the operation, the before/after values of the attributes
//! it changed, and who wrote it. GUI edits are not recorded — the session undo
//! stack covers them. Rows are kept for 30 days (`cleanup`) and feed the GUI's
//! Activity view, which groups them by author and restores them; restoring is a
//! GUI operation and is never exposed to agents.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;

use crate::error::Result;

/// Which external write path an author came through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthorSource {
    Mcp,
    Reporter,
}

impl AuthorSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::Reporter => "reporter",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "reporter" => Self::Reporter,
            _ => Self::Mcp,
        }
    }
}

/// 書き込み主（008 §5 の帰属）。Activity ビューはこの単位で変更をまとめる。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Author {
    pub source: AuthorSource,
    /// MCP はブリッジ接続 id（プロセスごと）、Reporter は登録 id。
    pub id: String,
    /// 表示名（MCP クライアントの `clientInfo.name` など）。無ければ GUI が id から補う。
    pub label: Option<String>,
}

/// 表示名の上限（文字数）。クライアントが自己申告する値なので、履歴の各行に
/// 複製される長さを抑える。
pub const MAX_AUTHOR_LABEL_CHARS: usize = 64;

impl Author {
    pub fn mcp(connection_id: impl Into<String>, client_name: Option<String>) -> Self {
        Self {
            source: AuthorSource::Mcp,
            id: connection_id.into(),
            label: client_name
                .filter(|n| !n.is_empty())
                .map(|n| n.chars().take(MAX_AUTHOR_LABEL_CHARS).collect()),
        }
    }

    pub fn reporter(reporter_id: impl Into<String>) -> Self {
        Self {
            source: AuthorSource::Reporter,
            id: reporter_id.into(),
            label: None,
        }
    }
}

/// What a history row changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    Card,
    Column,
}

impl TargetKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Card => "card",
            Self::Column => "column",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "column" => Self::Column,
            _ => Self::Card,
        }
    }
}

/// 記録する操作。before / after の形は操作ごとに決まっている:
///
/// | op | before | after |
/// |:---|:---|:---|
/// | `append_card` | – | `{column_id, content}` |
/// | `patch_card` / `stream_card` | `{content}` | `{content}` |
/// | `move_card` | `{column_id, after_card_id}` | 同左 |
/// | `delete_card` | `{deleted: false}` | `{deleted: true}` |
/// | `create_column` | – | `{name, description, private}` |
/// | `update_column` | `{name, description, private}` | 同左 |
/// | `move_column` | `{after_column_id}` | 同左 |
///
/// 位置は生の position ではなく直前の兄弟（`after_*_id`, 先頭なら null）で持つ。
/// 復元はアンカー指定の移動になり、その後の挿入・削除で position がずれても意図が保てる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeOp {
    AppendCard,
    PatchCard,
    /// Reporter のストリーム確定（`card.stream.end`）。内容の上書きとして記録する。
    StreamCard,
    MoveCard,
    DeleteCard,
    CreateColumn,
    UpdateColumn,
    MoveColumn,
}

impl ChangeOp {
    const ALL: [Self; 8] = [
        Self::AppendCard,
        Self::PatchCard,
        Self::StreamCard,
        Self::MoveCard,
        Self::DeleteCard,
        Self::CreateColumn,
        Self::UpdateColumn,
        Self::MoveColumn,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::AppendCard => "append_card",
            Self::PatchCard => "patch_card",
            Self::StreamCard => "stream_card",
            Self::MoveCard => "move_card",
            Self::DeleteCard => "delete_card",
            Self::CreateColumn => "create_column",
            Self::UpdateColumn => "update_column",
            Self::MoveColumn => "move_column",
        }
    }

    pub fn target_kind(self) -> TargetKind {
        match self {
            Self::CreateColumn | Self::UpdateColumn | Self::MoveColumn => TargetKind::Column,
            _ => TargetKind::Card,
        }
    }

    fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|op| op.as_str() == s)
    }
}

/// 履歴の 1 行。
#[derive(Debug, Clone, Serialize)]
pub struct ChangeRecord {
    pub id: String,
    pub deck_id: String,
    pub target_kind: TargetKind,
    pub target_id: String,
    pub op: ChangeOp,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub author: Author,
    pub created_at: DateTime<Utc>,
}

/// 1 書き込みを記録する。`write` 層が変更と同じトランザクション内で呼ぶ。
pub(crate) fn record(
    conn: &Connection,
    deck_id: &str,
    target_id: &str,
    op: ChangeOp,
    before: Option<Value>,
    after: Option<Value>,
    author: &Author,
) -> Result<()> {
    conn.execute(
        "INSERT INTO change_history
            (id, deck_id, target_kind, target_id, op, before, after,
             author_source, author_id, author_label, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            ulid::Ulid::generate().to_string(),
            deck_id,
            op.target_kind().as_str(),
            target_id,
            op.as_str(),
            before.map(|v| v.to_string()),
            after.map(|v| v.to_string()),
            author.source.as_str(),
            author.id,
            author.label,
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

const SELECT: &str = "SELECT id, deck_id, target_kind, target_id, op, before, after,
        author_source, author_id, author_label, created_at
    FROM change_history";

fn row_to_record(row: &rusqlite::Row) -> rusqlite::Result<Option<ChangeRecord>> {
    let json = |s: Option<String>| s.and_then(|s| serde_json::from_str(&s).ok());
    let op: String = row.get(4)?;
    // 未知の op（新しいバージョンが書いた行）は読み飛ばす。
    let Some(op) = ChangeOp::parse(&op) else {
        return Ok(None);
    };
    let created_at: String = row.get(10)?;
    let created_at = DateTime::parse_from_rfc3339(&created_at)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(e))
        })?;
    Ok(Some(ChangeRecord {
        id: row.get(0)?,
        deck_id: row.get(1)?,
        target_kind: TargetKind::parse(&row.get::<_, String>(2)?),
        target_id: row.get(3)?,
        op,
        before: json(row.get(5)?),
        after: json(row.get(6)?),
        author: Author {
            source: AuthorSource::parse(&row.get::<_, String>(7)?),
            id: row.get(8)?,
            label: row.get(9)?,
        },
        created_at,
    }))
}

fn collect(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<Vec<ChangeRecord>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, row_to_record)?;
    let mut out = Vec::new();
    for row in rows {
        if let Some(record) = row? {
            out.push(record);
        }
    }
    Ok(out)
}

/// Deck の履歴を新しい順に最大 `limit` 件（Activity ビュー）。
pub fn list_by_deck(conn: &Connection, deck_id: &str, limit: usize) -> Result<Vec<ChangeRecord>> {
    collect(
        conn,
        &format!("{SELECT} WHERE deck_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2"),
        params![deck_id, limit as i64],
    )
}

/// 1 つのカード / カラムの履歴を新しい順に（カード単位の履歴）。
pub fn list_by_target(conn: &Connection, target_id: &str) -> Result<Vec<ChangeRecord>> {
    collect(
        conn,
        &format!("{SELECT} WHERE target_id = ?1 ORDER BY created_at DESC, id DESC"),
        params![target_id],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewDeck, SortOrder};
    use crate::repository::deck;
    use serde_json::json;

    fn new_deck(conn: &Connection) -> String {
        deck::create(
            conn,
            NewDeck {
                name: "D".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn op_names_round_trip() {
        for op in ChangeOp::ALL {
            assert_eq!(ChangeOp::parse(op.as_str()), Some(op));
        }
        assert_eq!(ChangeOp::parse("future_op"), None);
    }

    #[test]
    fn records_round_trip_newest_first() {
        let conn = create_in_memory().unwrap();
        let d = new_deck(&conn);
        let agent = Author::mcp("conn-1", Some("Claude Code".to_string()));
        let reporter = Author::reporter("rep-1");

        record(
            &conn,
            &d,
            "card-1",
            ChangeOp::AppendCard,
            None,
            Some(json!({ "column_id": "col-1", "content": "a" })),
            &agent,
        )
        .unwrap();
        record(
            &conn,
            &d,
            "col-1",
            ChangeOp::UpdateColumn,
            Some(json!({ "name": "A" })),
            Some(json!({ "name": "B" })),
            &reporter,
        )
        .unwrap();

        let all = list_by_deck(&conn, &d, 10).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].op, ChangeOp::UpdateColumn);
        assert_eq!(all[0].target_kind, TargetKind::Column);
        assert_eq!(all[0].author, reporter);
        assert_eq!(all[1].op, ChangeOp::AppendCard);
        assert_eq!(all[1].before, None);
        assert_eq!(all[1].after, Some(json!({ "column_id": "col-1", "content": "a" })));
        assert_eq!(all[1].author.label.as_deref(), Some("Claude Code"));

        assert_eq!(list_by_deck(&conn, &d, 1).unwrap().len(), 1);
        let one = list_by_target(&conn, "card-1").unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].target_kind, TargetKind::Card);
    }

    #[test]
    fn unknown_ops_are_skipped_and_deck_deletion_cascades() {
        let conn = create_in_memory().unwrap();
        let d = new_deck(&conn);
        conn.execute(
            "INSERT INTO change_history (id, deck_id, target_kind, target_id, op, author_source, author_id, created_at)
             VALUES ('x', ?1, 'card', 'c', 'future_op', 'mcp', 'conn', ?2)",
            params![d, Utc::now().to_rfc3339()],
        )
        .unwrap();
        assert!(list_by_deck(&conn, &d, 10).unwrap().is_empty());

        deck::delete(&conn, &d).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM change_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn client_name_label_is_optional_and_bounded() {
        assert_eq!(Author::mcp("c", Some(String::new())).label, None);
        let long = "名".repeat(MAX_AUTHOR_LABEL_CHARS + 10);
        let label = Author::mcp("c", Some(long)).label.unwrap();
        assert_eq!(label.chars().count(), MAX_AUTHOR_LABEL_CHARS);
    }
}
