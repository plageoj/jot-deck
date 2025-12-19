use regex::Regex;
use rusqlite::{params, Connection};
use ulid::Ulid;

use crate::error::Result;
use crate::models::Tag;

/// タグ抽出のための正規表現
/// パターン: # + 英数字・アンダースコア・日本語（ひらがな・カタカナ・漢字）
fn get_tag_regex() -> Regex {
    Regex::new(r"#([\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]+)").unwrap()
}

/// テキストからタグを抽出する
pub fn extract_tags(content: &str) -> Vec<String> {
    let re = get_tag_regex();
    re.captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect()
}

/// タグを取得または作成する
pub fn get_or_create(conn: &Connection, name: &str) -> Result<Tag> {
    // まず既存のタグを検索
    let existing: Option<Tag> = conn
        .query_row(
            "SELECT id, name FROM tags WHERE name = ?1",
            params![name],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            },
        )
        .ok();

    if let Some(tag) = existing {
        return Ok(tag);
    }

    // 存在しなければ作成
    let id = Ulid::new().to_string();
    conn.execute(
        "INSERT INTO tags (id, name) VALUES (?1, ?2)",
        params![&id, name],
    )?;

    Ok(Tag {
        id,
        name: name.to_string(),
    })
}

/// Card にタグを関連付ける
pub fn associate_tag(conn: &Connection, card_id: &str, tag_id: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?1, ?2)",
        params![card_id, tag_id],
    )?;
    Ok(())
}

/// Card からタグの関連を解除する
pub fn disassociate_tag(conn: &Connection, card_id: &str, tag_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM card_tags WHERE card_id = ?1 AND tag_id = ?2",
        params![card_id, tag_id],
    )?;
    Ok(())
}

/// Card の全タグ関連を解除する
pub fn clear_card_tags(conn: &Connection, card_id: &str) -> Result<()> {
    conn.execute("DELETE FROM card_tags WHERE card_id = ?1", params![card_id])?;
    Ok(())
}

/// Card の内容からタグを同期する
/// 新しいタグを作成し、不要になったタグの関連を解除する
pub fn sync_card_tags(conn: &Connection, card_id: &str, content: &str) -> Result<Vec<Tag>> {
    let extracted_names = extract_tags(content);

    // 現在の関連タグを取得
    let current_tags = get_tags_by_card(conn, card_id)?;
    let current_names: std::collections::HashSet<_> =
        current_tags.iter().map(|t| t.name.clone()).collect();
    let new_names: std::collections::HashSet<_> = extracted_names.iter().cloned().collect();

    // 削除すべき関連
    for tag in &current_tags {
        if !new_names.contains(&tag.name) {
            disassociate_tag(conn, card_id, &tag.id)?;
        }
    }

    // 追加すべき関連
    let mut result_tags = Vec::new();
    for name in &extracted_names {
        let tag = get_or_create(conn, name)?;
        if !current_names.contains(name) {
            associate_tag(conn, card_id, &tag.id)?;
        }
        result_tags.push(tag);
    }

    Ok(result_tags)
}

/// Card に関連付けられたタグを取得する
pub fn get_tags_by_card(conn: &Connection, card_id: &str) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name FROM tags t JOIN card_tags ct ON t.id = ct.tag_id WHERE ct.card_id = ?1 ORDER BY t.name",
    )?;

    let tags = stmt
        .query_map(params![card_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// Deck 内で使用されているタグを取得する
pub fn get_tags_by_deck(conn: &Connection, deck_id: &str) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT t.id, t.name
         FROM tags t
         JOIN card_tags ct ON t.id = ct.tag_id
         JOIN cards c ON ct.card_id = c.id
         JOIN columns col ON c.column_id = col.id
         WHERE col.deck_id = ?1 AND c.deleted_at IS NULL AND col.deleted_at IS NULL
         ORDER BY t.name",
    )?;

    let tags = stmt
        .query_map(params![deck_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// タグ名で Card を検索する
pub fn get_cards_by_tag(conn: &Connection, deck_id: &str, tag_name: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT c.id
         FROM cards c
         JOIN card_tags ct ON c.id = ct.card_id
         JOIN tags t ON ct.tag_id = t.id
         JOIN columns col ON c.column_id = col.id
         WHERE col.deck_id = ?1 AND t.name = ?2 AND c.deleted_at IS NULL AND col.deleted_at IS NULL",
    )?;

    let card_ids = stmt
        .query_map(params![deck_id, tag_name], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(card_ids)
}

/// タグ名の補完候補を取得する
pub fn get_tag_suggestions(conn: &Connection, deck_id: &str, prefix: &str) -> Result<Vec<Tag>> {
    let pattern = format!("{}%", prefix);
    let mut stmt = conn.prepare(
        "SELECT DISTINCT t.id, t.name
         FROM tags t
         JOIN card_tags ct ON t.id = ct.tag_id
         JOIN cards c ON ct.card_id = c.id
         JOIN columns col ON c.column_id = col.id
         WHERE col.deck_id = ?1 AND t.name LIKE ?2 AND c.deleted_at IS NULL AND col.deleted_at IS NULL
         ORDER BY t.name
         LIMIT 10",
    )?;

    let tags = stmt
        .query_map(params![deck_id, &pattern], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_in_memory;
    use crate::models::{NewCard, NewColumn, NewDeck, SortOrder};
    use crate::repository::{card, column, deck};

    #[test]
    fn test_extract_tags() {
        let content = "This is a #test with #multiple #tags";
        let tags = extract_tags(content);
        assert_eq!(tags, vec!["test", "multiple", "tags"]);
    }

    #[test]
    fn test_extract_japanese_tags() {
        let content = "これは #テスト と #アイデア と #重要_メモ です";
        let tags = extract_tags(content);
        assert_eq!(tags, vec!["テスト", "アイデア", "重要_メモ"]);
    }

    #[test]
    fn test_sync_card_tags() {
        let conn = create_in_memory().unwrap();
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
                content: "#tag1 #tag2".to_string(),
            },
        )
        .unwrap();

        // 初回同期
        let tags = sync_card_tags(&conn, &c.id, "#tag1 #tag2").unwrap();
        assert_eq!(tags.len(), 2);

        // タグを変更
        let tags = sync_card_tags(&conn, &c.id, "#tag2 #tag3").unwrap();
        assert_eq!(tags.len(), 2);

        let card_tags = get_tags_by_card(&conn, &c.id).unwrap();
        let tag_names: Vec<_> = card_tags.iter().map(|t| t.name.clone()).collect();
        assert!(tag_names.contains(&"tag2".to_string()));
        assert!(tag_names.contains(&"tag3".to_string()));
        assert!(!tag_names.contains(&"tag1".to_string()));
    }

    #[test]
    fn test_get_tags_by_deck() {
        let conn = create_in_memory().unwrap();
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
        let c1 = card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "#alpha #beta".to_string(),
            },
        )
        .unwrap();
        let c2 = card::create(
            &conn,
            NewCard {
                column_id: col.id.clone(),
                content: "#beta #gamma".to_string(),
            },
        )
        .unwrap();

        sync_card_tags(&conn, &c1.id, &c1.content).unwrap();
        sync_card_tags(&conn, &c2.id, &c2.content).unwrap();

        let tags = get_tags_by_deck(&conn, &d.id).unwrap();
        assert_eq!(tags.len(), 3);
        let tag_names: Vec<_> = tags.iter().map(|t| t.name.clone()).collect();
        assert!(tag_names.contains(&"alpha".to_string()));
        assert!(tag_names.contains(&"beta".to_string()));
        assert!(tag_names.contains(&"gamma".to_string()));
    }

    #[test]
    fn test_tag_suggestions() {
        let conn = create_in_memory().unwrap();
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
                content: "#project #proposal #personal".to_string(),
            },
        )
        .unwrap();

        sync_card_tags(&conn, &c.id, &c.content).unwrap();

        let suggestions = get_tag_suggestions(&conn, &d.id, "pro").unwrap();
        assert_eq!(suggestions.len(), 2);
        let names: Vec<_> = suggestions.iter().map(|t| t.name.clone()).collect();
        assert!(names.contains(&"project".to_string()));
        assert!(names.contains(&"proposal".to_string()));
    }
}
