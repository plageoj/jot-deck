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
  getAllDecks: () => Promise.resolve(boardState.decks),
  setSettings: () => Promise.resolve(),
  getColumnsByDeck: () => Promise.resolve(boardState.columns),
  getCardsByColumn: (columnId: string) =>
    Promise.resolve(boardState.cardsByColumn.get(columnId) ?? []),
  getTagsByDeck: () => Promise.resolve(boardState.tagsByDeck),
  getDeletedColumns: () => Promise.resolve(boardState.deletedColumns),
  getDeletedCards: () => Promise.resolve(boardState.deletedCards),
  createColumn: (params) => {
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
    return Promise.resolve(col);
  },
  restoreCard: (id) => {
    boardState.restoreCardCalls.push(id);
    const idx = boardState.deletedCards.findIndex((c) => c.id === id);
    if (idx !== -1) boardState.deletedCards.splice(idx, 1);
    return Promise.resolve(makeCard(id, ""));
  },
  restoreColumn: (id) => {
    boardState.restoreColumnCalls.push(id);
    const idx = boardState.deletedColumns.findIndex((c) => c.id === id);
    if (idx !== -1) boardState.deletedColumns.splice(idx, 1);
    return Promise.resolve(makeColumn(id, ""));
  },
  createCard: (params) => {
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
    return Promise.resolve(card);
  },
  deleteColumn: (id) => {
    boardState.deleteColumnCalls.push(id);
    boardState.columns = boardState.columns.filter((c) => c.id !== id);
    return Promise.resolve();
  },
  deleteCard: (id) => {
    boardState.deleteCardCalls.push(id);
    for (const [colId, cards] of boardState.cardsByColumn) {
      boardState.cardsByColumn.set(
        colId,
        cards.filter((c) => c.id !== id),
      );
    }
    return Promise.resolve();
  },
  moveCard: (id, position) => {
    boardState.moveCardCalls.push({ id, position });
    return Promise.resolve(makeCard(id, "", { position }));
  },
  moveCardToColumn: (id, columnId) => {
    boardState.moveCardToColumnCalls.push({ id, column_id: columnId });
    return Promise.resolve(makeCard(id, columnId));
  },
  updateCardScore: (id, delta) => {
    boardState.updateCardScoreCalls.push({ id, delta });
    return Promise.resolve(makeCard(id, ""));
  },
  moveColumn: (id, position) => {
    boardState.moveColumnCalls.push({ id, position });
    return Promise.resolve(makeColumn(id, "", { position }));
  },
  createDeck: (params) => {
    boardState.createDeckCalls++;
    return Promise.resolve(
      makeDeck(`deck-new-${boardState.createDeckCalls}`, params.name ?? "Untitled"),
    );
  },
};
