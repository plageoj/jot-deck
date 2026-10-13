import type { Card, Column, Deck } from "#lib/types.ts";
import type { DatabaseBackend } from "#lib/db/index.ts";
import { makeCard, makeColumn, makeDeck } from "./models";

/**
 * Stateful fake backend for board-operation tests (ActionDispatcher and its
 * executors). Mutations update the in-memory board so reloads observe them, and
 * every call is recorded for assertions.
 *
 * Register it in a test file with:
 *
 *   vi.mock("#lib/db/index.ts", async () => {
 *     const { mockBackend } = await import("./__fixtures__/boardBackend");
 *     return { getDatabase: async () => mockBackend };
 *   });
 */
export const boardState = {
  decks: [] as Deck[],
  columns: [] as Column[],
  cardsByColumn: new Map<string, Card[]>(),
  tagsByDeck: [] as { id: string; name: string }[],
  createColumnCalls: [] as Array<{ deck_id: string; position?: number }>,
  deletedCards: [] as Card[],
  deletedColumns: [] as Column[],
  restoreCardCalls: [] as string[],
  restoreColumnCalls: [] as string[],
  createCardCalls: [] as Array<{ column_id: string; content: string; position?: number }>,
  deleteColumnCalls: [] as string[],
  deleteCardCalls: [] as string[],
  moveCardCalls: [] as Array<{ id: string; position: number }>,
  moveCardToColumnCalls: [] as Array<{ id: string; column_id: string }>,
  updateCardScoreCalls: [] as Array<{ id: string; delta: number }>,
  moveColumnCalls: [] as Array<{ id: string; position: number }>,
  createDeckCalls: 0,
};

export function resetBoardState(): void {
  boardState.decks = [];
  boardState.columns = [];
  boardState.cardsByColumn = new Map();
  boardState.tagsByDeck = [];
  boardState.createColumnCalls = [];
  boardState.deletedCards = [];
  boardState.deletedColumns = [];
  boardState.restoreCardCalls = [];
  boardState.restoreColumnCalls = [];
  boardState.createCardCalls = [];
  boardState.deleteColumnCalls = [];
  boardState.deleteCardCalls = [];
  boardState.moveCardCalls = [];
  boardState.moveCardToColumnCalls = [];
  boardState.updateCardScoreCalls = [];
  boardState.moveColumnCalls = [];
  boardState.createDeckCalls = 0;
  localStorage.clear();
}

export const mockBackend: Partial<DatabaseBackend> = {
  getAllDecks: async () => boardState.decks,
  getColumnsByDeck: async () => boardState.columns,
  getCardsByColumn: async (columnId: string) =>
    boardState.cardsByColumn.get(columnId) ?? [],
  getTagsByDeck: async () => boardState.tagsByDeck,
  getDeletedColumns: async () => boardState.deletedColumns,
  getDeletedCards: async () => boardState.deletedCards,
  createColumn: async (params) => {
    boardState.createColumnCalls.push(params);
    const col = makeColumn(
      `created-${boardState.createColumnCalls.length}`,
      params.deck_id,
      { position: params.position },
    );
    boardState.columns =
      params.position === undefined
        ? [...boardState.columns, col]
        : [
            ...boardState.columns.map((column) =>
              column.position >= params.position!
                ? { ...column, position: column.position + 1 }
                : column,
            ),
            col,
          ].sort((a, b) => a.position - b.position);
    boardState.cardsByColumn.set(col.id, []);
    return col;
  },
  restoreCard: async (id) => {
    boardState.restoreCardCalls.push(id);
    const idx = boardState.deletedCards.findIndex((c) => c.id === id);
    if (idx !== -1) boardState.deletedCards.splice(idx, 1);
    return makeCard(id, "");
  },
  restoreColumn: async (id) => {
    boardState.restoreColumnCalls.push(id);
    const idx = boardState.deletedColumns.findIndex((c) => c.id === id);
    if (idx !== -1) boardState.deletedColumns.splice(idx, 1);
    return makeColumn(id, "");
  },
  createCard: async (params) => {
    boardState.createCardCalls.push({
      column_id: params.column_id,
      content: params.content ?? "",
      position: params.position,
    });
    const card = makeCard(
      `created-card-${boardState.createCardCalls.length}`,
      params.column_id,
      { content: params.content, position: params.position },
    );
    const existing = boardState.cardsByColumn.get(params.column_id) ?? [];
    boardState.cardsByColumn.set(params.column_id, [...existing, card]);
    return card;
  },
  deleteColumn: async (id) => {
    boardState.deleteColumnCalls.push(id);
    boardState.columns = boardState.columns.filter((c) => c.id !== id);
  },
  deleteCard: async (id) => {
    boardState.deleteCardCalls.push(id);
    for (const [colId, cards] of boardState.cardsByColumn) {
      boardState.cardsByColumn.set(
        colId,
        cards.filter((c) => c.id !== id),
      );
    }
  },
  moveCard: async (id, position) => {
    boardState.moveCardCalls.push({ id, position });
    return makeCard(id, "", { position });
  },
  moveCardToColumn: async (id, columnId) => {
    boardState.moveCardToColumnCalls.push({ id, column_id: columnId });
    return makeCard(id, columnId);
  },
  updateCardScore: async (id, delta) => {
    boardState.updateCardScoreCalls.push({ id, delta });
    return makeCard(id, "");
  },
  moveColumn: async (id, position) => {
    boardState.moveColumnCalls.push({ id, position });
    return makeColumn(id, "", { position });
  },
  createDeck: async (params) => {
    boardState.createDeckCalls++;
    return makeDeck(`deck-new-${boardState.createDeckCalls}`, params.name ?? "Untitled");
  },
};
