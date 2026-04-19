export interface Deck {
  id: string;
  name: string;
  sort_order: string;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  deck_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Tag regex pattern source (without flags). Keep in sync with crates/core/repository/tag.rs */
export const TAG_PATTERN = "#([\\w\\u3040-\\u309f\\u30a0-\\u30ff\\u4e00-\\u9faf]+)";

export interface Tag {
  id: string;
  name: string;
}

export interface Card {
  id: string;
  column_id: string;
  content: string;
  score: number;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_with_column: boolean;
}
