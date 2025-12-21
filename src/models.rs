use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// カードのソート順
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SortOrder {
    /// 作成日時の新しい順（デフォルト）
    CreatedDesc,
    /// 作成日時の古い順
    CreatedAsc,
    /// スコアの高い順
    ScoreDesc,
    /// スコアの低い順
    ScoreAsc,
}

impl Default for SortOrder {
    fn default() -> Self {
        Self::CreatedDesc
    }
}

impl SortOrder {
    pub fn to_db_value(&self) -> &'static str {
        match self {
            Self::CreatedDesc => "created_desc",
            Self::CreatedAsc => "created_asc",
            Self::ScoreDesc => "score_desc",
            Self::ScoreAsc => "score_asc",
        }
    }

    pub fn from_db_value(s: &str) -> Self {
        match s {
            "created_asc" => Self::CreatedAsc,
            "score_desc" => Self::ScoreDesc,
            "score_asc" => Self::ScoreAsc,
            _ => Self::CreatedDesc,
        }
    }
}

/// Deck - Column の集合
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deck {
    pub id: String,
    pub name: String,
    pub sort_order: SortOrder,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Column - Card を縦に並べる領域
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub deck_id: String,
    pub name: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Card - テキスト入力の最小単位
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub column_id: String,
    pub content: String,
    pub score: i32,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
    /// Column 削除による連動削除かどうか
    pub deleted_with_column: bool,
}

/// Tag - カード本文中の #word 形式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
}

/// Card と Tag の関連
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardTag {
    pub card_id: String,
    pub tag_id: String,
}

// 作成用の構造体（ID や timestamp を含まない）

#[derive(Debug)]
pub struct NewDeck {
    pub name: String,
    pub sort_order: SortOrder,
}

#[derive(Debug)]
pub struct NewColumn {
    pub deck_id: String,
    pub name: String,
}

#[derive(Debug)]
pub struct NewCard {
    pub column_id: String,
    pub content: String,
}
