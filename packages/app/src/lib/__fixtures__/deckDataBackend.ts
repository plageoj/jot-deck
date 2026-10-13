import type { Card, Column, Deck, ReporterConfig } from "#lib/types.ts";
import type { DatabaseBackend } from "#lib/db/index.ts";
import { makeCard, makeColumn, makeDeck } from "./models";

/**
 * Call-recording fake backend for DeckData tests. Reads come from `deckState`;
 * mutations are recorded but (unlike boardBackend) do not change the board, so
 * tests set the post-mutation content explicitly before a reload.
 *
 * Register it in a test file with:
 *
 *   vi.mock("#lib/db/index.ts", async () => {
 *     const { mockBackend } = await import("./__fixtures__/deckDataBackend");
 *     return { getDatabase: async () => mockBackend, isTauri: () => false };
 *   });
 */
let nextId = 0;
const uniqueId = (prefix: string) => `${prefix}-${++nextId}`;

export const deckState = {
  decks: [] as Deck[],
  columns: [] as Column[],
  deletedColumns: [] as Column[],
  cardsByColumn: new Map<string, Card[]>(),
  deletedCards: [] as Card[],
  tagsByDeck: [] as { id: string; name: string }[],
  restoreCardCalls: [] as string[],
  restoreColumnCalls: [] as string[],
  getTagsByDeckCalls: 0,
  deleteDeckCalls: [] as string[],
  deleteColumnCalls: [] as string[],
  deleteCardCalls: [] as string[],
  moveColumnCalls: [] as Array<{ id: string; position: number }>,
  moveCardCalls: [] as Array<{ id: string; position: number }>,
  moveCardToColumnCalls: [] as Array<{ id: string; columnId: string }>,
  updateCardScoreCalls: [] as Array<{ id: string; delta: number }>,
  reporters: [] as ReporterConfig[],
  runningReporters: [] as string[],
  reporterCalls: [] as string[][],
};

export function resetDeckState(): void {
  deckState.decks = [];
  deckState.columns = [];
  deckState.deletedColumns = [];
  deckState.cardsByColumn = new Map();
  deckState.deletedCards = [];
  deckState.tagsByDeck = [];
  deckState.restoreCardCalls = [];
  deckState.restoreColumnCalls = [];
  deckState.getTagsByDeckCalls = 0;
  deckState.deleteDeckCalls = [];
  deckState.deleteColumnCalls = [];
  deckState.deleteCardCalls = [];
  deckState.moveColumnCalls = [];
  deckState.moveCardCalls = [];
  deckState.moveCardToColumnCalls = [];
  deckState.updateCardScoreCalls = [];
  deckState.reporters = [];
  deckState.runningReporters = [];
  deckState.reporterCalls = [];
  localStorage.clear();
}

/** Seeds a single loaded deck: `deck-1` with an empty `col-active`. */
export function seedSingleDeck(): void {
  resetDeckState();
  deckState.decks = [makeDeck("deck-1")];
  deckState.columns = [makeColumn("col-active", "deck-1")];
  deckState.cardsByColumn = new Map([["col-active", []]]);
}

function findCard(id: string): Card {
  const card = [...deckState.cardsByColumn.values()]
    .flat()
    .find((candidate) => candidate.id === id);
  return card ?? makeCard(id, "col-active");
}

export const mockBackend: Partial<DatabaseBackend> = {
  getAllDecks: async () => deckState.decks,
  getColumnsByDeck: async () => deckState.columns,
  getCardsByColumn: async (columnId: string) =>
    deckState.cardsByColumn.get(columnId) ?? [],
  getTagsByDeck: async () => {
    deckState.getTagsByDeckCalls++;
    return deckState.tagsByDeck;
  },
  getDeletedColumns: async () => deckState.deletedColumns,
  getDeletedCards: async () => deckState.deletedCards,
  restoreCard: async (id: string) => {
    deckState.restoreCardCalls.push(id);
    const idx = deckState.deletedCards.findIndex((c) => c.id === id);
    if (idx !== -1) deckState.deletedCards.splice(idx, 1);
    return {} as Card;
  },
  restoreColumn: async (id: string) => {
    deckState.restoreColumnCalls.push(id);
    const idx = deckState.deletedColumns.findIndex((c) => c.id === id);
    if (idx !== -1) deckState.deletedColumns.splice(idx, 1);
    return {} as Column;
  },
  deleteDeck: async (id) => {
    deckState.deleteDeckCalls.push(id);
  },
  createDeck: async (params) =>
    makeDeck(uniqueId("new-deck"), params.name ?? "New Deck"),
  updateDeck: async (id, name) => makeDeck(id, name),
  createColumn: async (params) =>
    makeColumn(uniqueId("new-col"), params.deck_id, {
      position: params.position,
    }),
  updateColumn: async (id, name, description, isPrivate) => ({
    ...makeColumn(id, "deck-1", {
      description: description ?? null,
      private: isPrivate ?? false,
    }),
    name: name ?? `${id}-name`,
  }),
  createCard: async (params) =>
    makeCard(uniqueId("new-card"), params.column_id, {
      content: params.content,
      position: params.position,
    }),
  updateCardContent: async (id, content) => makeCard(id, "col-active", { content }),
  acquireCardLock: async (id) => ({ ...findCard(id), locked_by: "user" }),
  updateCardContentCas: async (id, content) => ({
    ...findCard(id),
    content,
    locked_by: "user",
  }),
  updateCardContentCasOwned: async (id, holder, content) => ({
    ...findCard(id),
    content,
    locked_by: holder,
  }),
  updateCardContentCasAndRelease: async (id, _holder, content) => ({
    ...findCard(id),
    content,
    locked_by: null,
    locked_at: null,
  }),
  releaseCardLock: async (id) => ({
    ...findCard(id),
    locked_by: null,
    locked_at: null,
  }),
  deleteColumn: async (id) => {
    deckState.deleteColumnCalls.push(id);
  },
  deleteCard: async (id) => {
    deckState.deleteCardCalls.push(id);
  },
  moveColumn: async (id, position) => {
    deckState.moveColumnCalls.push({ id, position });
    return makeColumn(id, "deck-1", { position });
  },
  moveCard: async (id, position) => {
    deckState.moveCardCalls.push({ id, position });
    return makeCard(id, "col-active", { position });
  },
  moveCardToColumn: async (id, columnId) => {
    deckState.moveCardToColumnCalls.push({ id, columnId });
    return makeCard(id, columnId);
  },
  updateCardScore: async (id, delta) => {
    deckState.updateCardScoreCalls.push({ id, delta });
    return makeCard(id, "col-active");
  },
  getTagSuggestions: async (_deckId: string, prefix: string) =>
    [{ id: `tag-${prefix}`, name: `${prefix}-suggestion` }],
  listReporters: async (deckId: string) => {
    deckState.reporterCalls.push(["listReporters", deckId]);
    return deckState.reporters;
  },
  addReporter: async (deckId: string, config: ReporterConfig) => {
    deckState.reporterCalls.push(["addReporter", deckId, config.name]);
    return { ...config, reporter_id: "assigned-id" };
  },
  updateReporter: async (deckId: string, config: ReporterConfig) => {
    deckState.reporterCalls.push(["updateReporter", deckId, config.reporter_id]);
    return config;
  },
  removeReporter: async (deckId: string, reporterId: string) => {
    deckState.reporterCalls.push(["removeReporter", deckId, reporterId]);
  },
  startReporter: async (deckId: string, reporterId: string) => {
    deckState.reporterCalls.push(["startReporter", deckId, reporterId]);
  },
  stopReporter: async (reporterId: string) => {
    deckState.reporterCalls.push(["stopReporter", reporterId]);
  },
  listRunningReporters: async () => {
    deckState.reporterCalls.push(["listRunningReporters"]);
    return deckState.runningReporters;
  },
};
