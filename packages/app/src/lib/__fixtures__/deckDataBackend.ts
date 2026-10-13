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
  getAllDecks: () => Promise.resolve(deckState.decks),
  getColumnsByDeck: () => Promise.resolve(deckState.columns),
  getCardsByColumn: (columnId: string) =>
    Promise.resolve(deckState.cardsByColumn.get(columnId) ?? []),
  getTagsByDeck: () => {
    deckState.getTagsByDeckCalls++;
    return Promise.resolve(deckState.tagsByDeck);
  },
  getDeletedColumns: () => Promise.resolve(deckState.deletedColumns),
  getDeletedCards: () => Promise.resolve(deckState.deletedCards),
  restoreCard: (id: string) => {
    deckState.restoreCardCalls.push(id);
    const idx = deckState.deletedCards.findIndex((c) => c.id === id);
    if (idx !== -1) deckState.deletedCards.splice(idx, 1);
    return Promise.resolve({} as Card);
  },
  restoreColumn: (id: string) => {
    deckState.restoreColumnCalls.push(id);
    const idx = deckState.deletedColumns.findIndex((c) => c.id === id);
    if (idx !== -1) deckState.deletedColumns.splice(idx, 1);
    return Promise.resolve({} as Column);
  },
  deleteDeck: (id) => {
    deckState.deleteDeckCalls.push(id);
    return Promise.resolve();
  },
  createDeck: (params) =>
    Promise.resolve(makeDeck(uniqueId("new-deck"), params.name ?? "New Deck")),
  updateDeck: (id, name) => Promise.resolve(makeDeck(id, name)),
  createColumn: (params) =>
    Promise.resolve(
      makeColumn(uniqueId("new-col"), params.deck_id, {
        position: params.position,
      }),
    ),
  updateColumn: (id, name, description, isPrivate) =>
    Promise.resolve({
      ...makeColumn(id, "deck-1", {
        description: description ?? null,
        private: isPrivate ?? false,
      }),
      name: name ?? `${id}-name`,
    }),
  createCard: (params) =>
    Promise.resolve(
      makeCard(uniqueId("new-card"), params.column_id, {
        content: params.content,
        position: params.position,
      }),
    ),
  updateCardContent: (id, content) =>
    Promise.resolve(makeCard(id, "col-active", { content })),
  acquireCardLock: (id) => Promise.resolve({ ...findCard(id), locked_by: "user" }),
  updateCardContentCas: (id, content) =>
    Promise.resolve({ ...findCard(id), content, locked_by: "user" }),
  updateCardContentCasOwned: (id, holder, content) =>
    Promise.resolve({ ...findCard(id), content, locked_by: holder }),
  updateCardContentCasAndRelease: (id, _holder, content) =>
    Promise.resolve({ ...findCard(id), content, locked_by: null, locked_at: null }),
  releaseCardLock: (id) =>
    Promise.resolve({ ...findCard(id), locked_by: null, locked_at: null }),
  deleteColumn: (id) => {
    deckState.deleteColumnCalls.push(id);
    return Promise.resolve();
  },
  deleteCard: (id) => {
    deckState.deleteCardCalls.push(id);
    return Promise.resolve();
  },
  moveColumn: (id, position) => {
    deckState.moveColumnCalls.push({ id, position });
    return Promise.resolve(makeColumn(id, "deck-1", { position }));
  },
  moveCard: (id, position) => {
    deckState.moveCardCalls.push({ id, position });
    return Promise.resolve(makeCard(id, "col-active", { position }));
  },
  moveCardToColumn: (id, columnId) => {
    deckState.moveCardToColumnCalls.push({ id, columnId });
    return Promise.resolve(makeCard(id, columnId));
  },
  updateCardScore: (id, delta) => {
    deckState.updateCardScoreCalls.push({ id, delta });
    return Promise.resolve(makeCard(id, "col-active"));
  },
  getTagSuggestions: (_deckId: string, prefix: string) =>
    Promise.resolve([{ id: `tag-${prefix}`, name: `${prefix}-suggestion` }]),
  listReporters: (deckId: string) => {
    deckState.reporterCalls.push(["listReporters", deckId]);
    return Promise.resolve(deckState.reporters);
  },
  addReporter: (deckId: string, config: ReporterConfig) => {
    deckState.reporterCalls.push(["addReporter", deckId, config.name]);
    return Promise.resolve({ ...config, reporter_id: "assigned-id" });
  },
  updateReporter: (deckId: string, config: ReporterConfig) => {
    deckState.reporterCalls.push(["updateReporter", deckId, config.reporter_id]);
    return Promise.resolve(config);
  },
  removeReporter: (deckId: string, reporterId: string) => {
    deckState.reporterCalls.push(["removeReporter", deckId, reporterId]);
    return Promise.resolve();
  },
  startReporter: (deckId: string, reporterId: string) => {
    deckState.reporterCalls.push(["startReporter", deckId, reporterId]);
    return Promise.resolve();
  },
  stopReporter: (reporterId: string) => {
    deckState.reporterCalls.push(["stopReporter", reporterId]);
    return Promise.resolve();
  },
  listRunningReporters: () => {
    deckState.reporterCalls.push(["listRunningReporters"]);
    return Promise.resolve(deckState.runningReporters);
  },
};
