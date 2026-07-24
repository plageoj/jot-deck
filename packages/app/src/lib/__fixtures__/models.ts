import type { Card, Column, Deck } from "$lib/types";

export function makeDeck(id: string, name = id): Deck {
  return {
    id,
    name,
    sort_order: "created_desc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

export function makeColumn(
  id: string,
  deckId: string,
  options: {
    position?: number;
    deletedAt?: string;
    description?: string | null;
    private?: boolean;
  } = {},
): Column {
  return {
    id,
    deck_id: deckId,
    name: `${id}-name`,
    position: options.position ?? 0,
    description: options.description ?? null,
    private: options.private ?? false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: options.deletedAt ?? null,
  };
}

export function makeCard(
  id: string,
  columnId: string,
  options: {
    position?: number;
    content?: string;
    deletedAt?: string;
    deletedWithColumn?: boolean;
  } = {},
): Card {
  return {
    id,
    column_id: columnId,
    content: options.content ?? `${id} content`,
    score: 0,
    position: options.position ?? 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: options.deletedAt ?? null,
    deleted_with_column: options.deletedWithColumn ?? false,
    locked_by: null,
    locked_at: null,
  };
}
