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
