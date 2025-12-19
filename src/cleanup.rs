use chrono::{Duration, Utc};
use rusqlite::{params, Connection};

use crate::error::Result;

/// 物理削除の対象期間（日数）
const DELETE_AFTER_DAYS: i64 = 30;

/// 削除結果
#[derive(Debug, Default)]
pub struct CleanupResult {
    pub deleted_columns: usize,
    pub deleted_cards: usize,
    pub deleted_orphan_tags: usize,
}

/// 論理削除から指定日数経過したデータを物理削除する
pub fn cleanup_old_deleted(conn: &mut Connection) -> Result<CleanupResult> {
    let threshold = Utc::now() - Duration::days(DELETE_AFTER_DAYS);
    let threshold_str = threshold.to_rfc3339();

    cleanup_with_threshold(conn, &threshold_str)
}

/// 指定した閾値より古い論理削除データを物理削除する（テスト用）
pub fn cleanup_with_threshold(conn: &mut Connection, threshold: &str) -> Result<CleanupResult> {
    let tx = conn.transaction()?;
    let mut result = CleanupResult::default();

    // 1. 削除対象の Card に関連するタグの関連を削除
    tx.execute(
        "DELETE FROM card_tags WHERE card_id IN (SELECT id FROM cards WHERE deleted_at IS NOT NULL AND deleted_at < ?1)",
        params![threshold],
    )?;

    // 2. 削除対象の Card を物理削除
    result.deleted_cards = tx.execute(
        "DELETE FROM cards WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![threshold],
    )?;

    // 3. 削除対象の Column を物理削除（所属する Card は既に削除済み、または連動削除で削除されている）
    result.deleted_columns = tx.execute(
        "DELETE FROM columns WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![threshold],
    )?;

    // 4. どの Card にも関連付けられていない孤立タグを削除
    result.deleted_orphan_tags = tx.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM card_tags)",
        [],
    )?;

    tx.commit()?;
    Ok(result)
}

/// 全 Deck の物理削除バッチを実行
pub fn run_cleanup_batch(conn: &mut Connection) -> Result<CleanupResult> {
    cleanup_old_deleted(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewCard, NewColumn, NewDeck, SortOrder};
    use crate::repository::{card, column, deck, tag};
    use chrono::Duration;

    #[test]
    fn test_cleanup_old_deleted() {
        let mut conn = create_in_memory().unwrap();

        // テストデータ作成
        let d = deck::create(
            &conn,
            NewDeck {
                name: "Test".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();

        let col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Col".to_string(),
            },
        )
        .unwrap();

        let c = card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "#test content".to_string(),
            },
        )
        .unwrap();

        // タグを同期
        tag::sync_card_tags(&conn, &c.id, &c.content).unwrap();

        // Card を論理削除
        card::soft_delete(&conn, &c.id).unwrap();

        // 現時点での cleanup では削除されない（30日経過していない）
        let result = cleanup_old_deleted(&mut conn).unwrap();
        assert_eq!(result.deleted_cards, 0);

        // deleted_at を 31 日前に更新（テスト用）
        let old_date = (Utc::now() - Duration::days(31)).to_rfc3339();
        conn.execute(
            "UPDATE cards SET deleted_at = ?1 WHERE id = ?2",
            params![&old_date, &c.id],
        )
        .unwrap();

        // cleanup 実行
        let result = cleanup_old_deleted(&mut conn).unwrap();
        assert_eq!(result.deleted_cards, 1);
        assert_eq!(result.deleted_orphan_tags, 1);

        // Card が物理削除されていることを確認
        let cards: Vec<String> = conn
            .prepare("SELECT id FROM cards WHERE id = ?1")
            .unwrap()
            .query_map(params![&c.id], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(cards.is_empty());
    }

    #[test]
    fn test_cleanup_column_with_cards() {
        let mut conn = create_in_memory().unwrap();

        let d = deck::create(
            &conn,
            NewDeck {
                name: "Test".to_string(),
                sort_order: SortOrder::default(),
            },
        )
        .unwrap();

        let col = column::create(
            &conn,
            NewColumn {
                deck_id: d.id.clone(),
                name: "Col".to_string(),
            },
        )
        .unwrap();

        card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "Card 1".to_string(),
            },
        )
        .unwrap();

        card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "Card 2".to_string(),
            },
        )
        .unwrap();

        // Column を論理削除（Card も連動削除される）
        column::soft_delete(&conn, &col.id).unwrap();

        // deleted_at を 31 日前に更新
        let old_date = (Utc::now() - Duration::days(31)).to_rfc3339();
        conn.execute(
            "UPDATE columns SET deleted_at = ?1 WHERE id = ?2",
            params![&old_date, &col.id],
        )
        .unwrap();
        conn.execute(
            "UPDATE cards SET deleted_at = ?1 WHERE column_id = ?2",
            params![&old_date, &col.id],
        )
        .unwrap();

        // cleanup 実行
        let result = cleanup_old_deleted(&mut conn).unwrap();
        assert_eq!(result.deleted_columns, 1);
        assert_eq!(result.deleted_cards, 2);
    }
}
