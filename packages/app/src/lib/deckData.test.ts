import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Card, Column, Deck } from "$lib/types";
import type { DatabaseBackend } from "$lib/db";
import { makeCard, makeColumn, makeDeck } from "./__fixtures__/models";

let nextId = 0;
const uniqueId = (prefix: string) => `${prefix}-${++nextId}`;

const state = {
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
};

const mockBackend: Partial<DatabaseBackend> = {
  getAllDecks: async () => state.decks,
  getColumnsByDeck: async () => state.columns,
  getCardsByColumn: async (columnId: string) =>
    state.cardsByColumn.get(columnId) ?? [],
  getTagsByDeck: async () => {
    state.getTagsByDeckCalls++;
    return state.tagsByDeck;
  },
  getDeletedColumns: async () => state.deletedColumns,
  getDeletedCards: async () => state.deletedCards,
  restoreCard: async (id: string) => {
    state.restoreCardCalls.push(id);
    const idx = state.deletedCards.findIndex((c) => c.id === id);
    if (idx !== -1) state.deletedCards.splice(idx, 1);
    return {} as Card;
  },
  restoreColumn: async (id: string) => {
    state.restoreColumnCalls.push(id);
    const idx = state.deletedColumns.findIndex((c) => c.id === id);
    if (idx !== -1) state.deletedColumns.splice(idx, 1);
    return {} as Column;
  },
  deleteDeck: async (id) => {
    state.deleteDeckCalls.push(id);
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
  deleteColumn: async (id) => {
    state.deleteColumnCalls.push(id);
  },
  deleteCard: async (id) => {
    state.deleteCardCalls.push(id);
  },
  moveColumn: async (id, position) => {
    state.moveColumnCalls.push({ id, position });
    return makeColumn(id, "deck-1", { position });
  },
  moveCard: async (id, position) => {
    state.moveCardCalls.push({ id, position });
    return makeCard(id, "col-active", { position });
  },
  moveCardToColumn: async (id, columnId) => {
    state.moveCardToColumnCalls.push({ id, columnId });
    return makeCard(id, columnId);
  },
  updateCardScore: async (id, delta) => {
    state.updateCardScoreCalls.push({ id, delta });
    return makeCard(id, "col-active");
  },
  getTagSuggestions: async (_deckId: string, prefix: string) =>
    [{ id: `tag-${prefix}`, name: `${prefix}-suggestion` }],
};

vi.mock("$lib/db", () => ({
  getDatabase: async () => mockBackend,
}));

const { DeckData } = await import("./deckData.svelte");
const { FOCUS_STATE_PREFIX } = await import("./focusManager.svelte");
const focusKey = (deckId: string) => FOCUS_STATE_PREFIX + deckId;

function resetState() {
  state.decks = [];
  state.columns = [];
  state.deletedColumns = [];
  state.cardsByColumn = new Map();
  state.deletedCards = [];
  state.tagsByDeck = [];
  state.restoreCardCalls = [];
  state.restoreColumnCalls = [];
  state.getTagsByDeckCalls = 0;
  state.deleteDeckCalls = [];
  state.deleteColumnCalls = [];
  state.deleteCardCalls = [];
  state.moveColumnCalls = [];
  state.moveCardCalls = [];
  state.moveCardToColumnCalls = [];
  state.updateCardScoreCalls = [];
  localStorage.clear();
}

describe("DeckData trash", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-active", "deck-1")];
    state.cardsByColumn = new Map([["col-active", []]]);

    data = new DeckData();
    await data.init();
  });

  it("returns empty trash when nothing is deleted", async () => {
    const items = await data.getTrashItems();
    expect(items).toEqual([]);
  });

  it("merges deleted columns and cards in deleted_at descending order", async () => {
    state.deletedColumns = [
      makeColumn("col-old", "deck-1", { deletedAt: "2026-05-01T10:00:00Z" }),
      makeColumn("col-new", "deck-1", { deletedAt: "2026-05-03T10:00:00Z" }),
    ];
    state.deletedCards = [
      makeCard("card-mid", "col-active", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const items = await data.getTrashItems();

    expect(items.map((i) => i.id)).toEqual(["col-new", "card-mid", "col-old"]);
    expect(items[0].type).toBe("column");
    expect(items[1].type).toBe("card");
  });

  it("excludes cards deleted via cascade (deleted_with_column)", async () => {
    state.deletedColumns = [
      makeColumn("col-deleted", "deck-1", { deletedAt: "2026-05-01T10:00:00Z" }),
    ];
    state.deletedCards = [
      makeCard("card-cascade", "col-deleted", {
        deletedAt: "2026-05-01T10:00:00Z",
        deletedWithColumn: true,
      }),
      makeCard("card-standalone", "col-active", {
        deletedAt: "2026-05-02T10:00:00Z",
      }),
    ];

    const items = await data.getTrashItems();

    expect(items.map((i) => i.id)).toEqual(["card-standalone", "col-deleted"]);
    expect(items.find((i) => i.id === "card-cascade")).toBeUndefined();
  });

  it("attaches column name to card trash items, including for already-deleted columns", async () => {
    state.deletedColumns = [
      makeColumn("col-gone", "deck-1", { deletedAt: "2026-05-01T10:00:00Z" }),
    ];
    state.deletedCards = [
      // standalone card whose parent column is itself in trash
      makeCard("card-orphan", "col-gone", {
        deletedAt: "2026-05-02T10:00:00Z",
      }),
    ];

    const items = await data.getTrashItems();
    const card = items.find((i) => i.id === "card-orphan");

    expect(card).toBeDefined();
    if (card?.type === "card") {
      expect(card.columnName).toBe("col-gone-name");
    } else {
      throw new Error("expected card-orphan to be a card-type trash item");
    }
  });

  it("restoreTrashItem dispatches to restoreCard for cards", async () => {
    state.deletedCards = [
      makeCard("card-1", "col-active", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const [item] = await data.getTrashItems();
    const ok = await data.restoreTrashItem(item);

    expect(ok).toBe(true);
    expect(state.restoreCardCalls).toEqual(["card-1"]);
    expect(state.restoreColumnCalls).toEqual([]);
  });

  it("restoreTrashItem dispatches to restoreColumn for columns", async () => {
    state.deletedColumns = [
      makeColumn("col-x", "deck-1", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const [item] = await data.getTrashItems();
    const ok = await data.restoreTrashItem(item);

    expect(ok).toBe(true);
    expect(state.restoreColumnCalls).toEqual(["col-x"]);
    expect(state.restoreCardCalls).toEqual([]);
  });

  it("undoLastDelete restores the most recent deletion", async () => {
    state.deletedCards = [
      makeCard("card-old", "col-active", { deletedAt: "2026-05-01T10:00:00Z" }),
      makeCard("card-new", "col-active", { deletedAt: "2026-05-03T10:00:00Z" }),
    ];

    const ok = await data.undoLastDelete();

    expect(ok).toBe(true);
    expect(state.restoreCardCalls).toEqual(["card-new"]);
  });

  it("undoLastDelete returns false when trash is empty", async () => {
    const ok = await data.undoLastDelete();
    expect(ok).toBe(false);
    expect(state.restoreCardCalls).toEqual([]);
    expect(state.restoreColumnCalls).toEqual([]);
  });

  it("undoLastDelete called repeatedly walks the stack newest-first", async () => {
    state.deletedCards = [
      makeCard("card-a", "col-active", { deletedAt: "2026-05-01T10:00:00Z" }),
      makeCard("card-b", "col-active", { deletedAt: "2026-05-02T10:00:00Z" }),
      makeCard("card-c", "col-active", { deletedAt: "2026-05-03T10:00:00Z" }),
    ];

    await data.undoLastDelete();
    await data.undoLastDelete();
    await data.undoLastDelete();

    expect(state.restoreCardCalls).toEqual(["card-c", "card-b", "card-a"]);
  });

  it("breaks deleted_at ties deterministically by id (descending)", async () => {
    // Same deletedAt — order must be stable and id-descending so undo picks
    // the same item every time, regardless of source-table merge order.
    const sameTs = "2026-05-02T10:00:00Z";
    state.deletedColumns = [makeColumn("id-c", "deck-1", { deletedAt: sameTs })];
    state.deletedCards = [
      makeCard("id-a", "col-active", { deletedAt: sameTs }),
      makeCard("id-b", "col-active", { deletedAt: sameTs }),
    ];

    // Mutate input order (insert column second, swap card order) — sort
    // should still produce the same id-desc order.
    const items = await data.getTrashItems();
    expect(items.map((i) => i.id)).toEqual(["id-c", "id-b", "id-a"]);

    state.deletedColumns = [makeColumn("id-c", "deck-1", { deletedAt: sameTs })];
    state.deletedCards = [
      makeCard("id-b", "col-active", { deletedAt: sameTs }),
      makeCard("id-a", "col-active", { deletedAt: sameTs }),
    ];
    const items2 = await data.getTrashItems();
    expect(items2.map((i) => i.id)).toEqual(["id-c", "id-b", "id-a"]);
  });

  it("refreshes deck tags after restoring an item", async () => {
    state.deletedCards = [
      makeCard("card-1", "col-active", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const callsBefore = state.getTagsByDeckCalls;
    const [item] = await data.getTrashItems();
    await data.restoreTrashItem(item);

    expect(state.getTagsByDeckCalls).toBeGreaterThan(callsBefore);
  });

  it("selectDeck sets loadedDeckId only after columns finish loading", async () => {
    state.decks = [makeDeck("deck-load-test")];
    state.columns = [makeColumn("col-x", "deck-load-test")];
    state.cardsByColumn = new Map([["col-x", []]]);

    const fresh = new DeckData();
    await fresh.init();

    expect(fresh.loadedDeckId).toBe("deck-load-test");
    expect(fresh.currentDeck?.id).toBe("deck-load-test");
  });

  it("selectDeck temporarily clears loadedDeckId during a switch", async () => {
    state.decks = [makeDeck("deck-1"), makeDeck("deck-2")];
    state.columns = [makeColumn("col-active", "deck-1")];
    state.cardsByColumn = new Map([["col-active", []]]);

    const fresh = new DeckData();
    await fresh.init();
    expect(fresh.loadedDeckId).toBe("deck-1");

    // Swap mock backend to return deck-2's columns when queried.
    state.columns = [makeColumn("col-2-only", "deck-2")];
    state.cardsByColumn = new Map([["col-2-only", []]]);

    const promise = fresh.selectDeck(makeDeck("deck-2"));
    // Synchronously after kicking off selectDeck, loadedDeckId is null.
    expect(fresh.loadedDeckId).toBeNull();
    await promise;
    expect(fresh.loadedDeckId).toBe("deck-2");
  });

  it("deleteDeck clears persisted focus state for the deleted deck", async () => {
    localStorage.setItem(
      focusKey("deck-doomed"),
      JSON.stringify({
        focusedColumnIndex: 3,
        lastFocusedCardByColumn: { "col-y": 7 },
        focusMode: "column",
      }),
    );
    state.decks = [makeDeck("deck-doomed"), makeDeck("deck-other")];

    const fresh = new DeckData();
    await fresh.init();

    await fresh.deleteDeck("deck-doomed");

    expect(localStorage.getItem(focusKey("deck-doomed"))).toBeNull();
  });

  it("re-applies an active tag filter after restoring", async () => {
    // Active card with #todo so the filter resolves to a non-empty set.
    state.cardsByColumn = new Map([
      [
        "col-active",
        [makeCard("card-active", "col-active", { content: "#todo task" })],
      ],
    ]);
    state.deletedCards = [
      makeCard("card-deleted", "col-active", {
        deletedAt: "2026-05-02T10:00:00Z",
        content: "#todo old",
      }),
    ];

    // Sync DeckData's cardsByColumn with the new mock content above.
    await data.loadCardsForColumns();
    data.filterByTag("todo");
    expect(data.filteredCardIds?.has("card-active")).toBe(true);

    // Simulate the deleted card returning to col-active after restore.
    state.cardsByColumn = new Map([
      [
        "col-active",
        [
          makeCard("card-active", "col-active", { content: "#todo task" }),
          makeCard("card-deleted", "col-active", { content: "#todo old" }),
        ],
      ],
    ]);

    const [item] = await data.getTrashItems();
    await data.restoreTrashItem(item);

    expect(data.activeTagFilter).toBe("todo");
    expect(data.filteredCardIds?.has("card-active")).toBe(true);
    expect(data.filteredCardIds?.has("card-deleted")).toBe(true);
  });
});

describe("DeckData CRUD", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-active", "deck-1")];
    state.cardsByColumn = new Map([["col-active", []]]);

    data = new DeckData();
    await data.init();
  });

  it("createDeck adds a deck and selects it", async () => {
    const created = await data.createDeck();
    expect(created).not.toBeNull();
    expect(data.decks[0].id).toBe(created!.id);
    expect(data.currentDeck?.id).toBe(created!.id);
  });

  it("renameDeck updates the deck name and currentDeck", async () => {
    const updated = await data.renameDeck(data.currentDeck!.id, "Renamed");
    expect(updated?.name).toBe("Renamed");
    expect(data.currentDeck?.name).toBe("Renamed");
  });

  it("deleteDeck on the only deck clears currentDeck and columns", async () => {
    await data.deleteDeck(data.currentDeck!.id);
    expect(data.currentDeck).toBeNull();
    expect(data.columns).toEqual([]);
    expect(data.cardsByColumn).toEqual({});
    expect(data.deckTags).toEqual([]);
  });

  it("deleteDeck on a non-current deck preserves currentDeck", async () => {
    state.decks = [makeDeck("deck-1"), makeDeck("deck-2")];
    const fresh = new DeckData();
    await fresh.init();
    expect(fresh.currentDeck?.id).toBe("deck-1");

    await fresh.deleteDeck("deck-2");
    expect(fresh.currentDeck?.id).toBe("deck-1");
    expect(fresh.decks.find((d) => d.id === "deck-2")).toBeUndefined();
  });

  it("renameColumn updates the column entry", async () => {
    const updated = await data.renameColumn("col-active", "Renamed Col");
    expect(updated?.name).toBe("Renamed Col");
    expect(data.columns.find((c) => c.id === "col-active")?.name).toBe(
      "Renamed Col",
    );
  });

  it("createColumn appends a new column with empty cards array", async () => {
    const before = data.columns.length;
    const col = await data.createColumn();
    expect(col).not.toBeNull();
    expect(data.columns.length).toBe(before + 1);
    expect(data.cardsByColumn[col!.id]).toEqual([]);
  });

  it("createColumn returns null when no current deck is set", async () => {
    data.currentDeck = null;
    const col = await data.createColumn();
    expect(col).toBeNull();
  });

  it("createColumnAtPosition reloads columns and returns the new column", async () => {
    const col = await data.createColumnAtPosition(0);
    expect(col).not.toBeNull();
  });

  it("createCard without position appends and returns the new card", async () => {
    const card = await data.createCard("col-active", "hello");
    expect(card).not.toBeNull();
    expect(data.cardsByColumn["col-active"].at(-1)?.id).toBe(card!.id);
  });

  it("createCard with position triggers a card reload", async () => {
    const card = await data.createCard("col-active", "with position", 0);
    expect(card).not.toBeNull();
  });

  it("saveCard replaces the card content for the matching id", async () => {
    state.cardsByColumn = new Map([
      ["col-active", [makeCard("card-1", "col-active", { content: "old" })]],
    ]);
    await data.loadCardsForColumns();

    await data.saveCard("card-1", "new content");

    const stored = data.cardsByColumn["col-active"].find(
      (c) => c.id === "card-1",
    );
    expect(stored?.content).toBe("new content");
  });

  it("deleteColumn forwards the id to the backend", async () => {
    const ok = await data.deleteColumn("col-active");
    expect(ok).toBe(true);
    expect(state.deleteColumnCalls).toEqual(["col-active"]);
  });

  it("deleteCard forwards the id to the backend", async () => {
    const ok = await data.deleteCard("card-x");
    expect(ok).toBe(true);
    expect(state.deleteCardCalls).toEqual(["card-x"]);
  });

  it("moveColumn forwards id and position to the backend", async () => {
    expect(await data.moveColumn("col-active", 1)).toBe(true);
    expect(state.moveColumnCalls).toEqual([{ id: "col-active", position: 1 }]);
  });

  it("moveCard forwards id and position to the backend", async () => {
    expect(await data.moveCard("card-x", 0)).toBe(true);
    expect(state.moveCardCalls).toEqual([{ id: "card-x", position: 0 }]);
  });

  it("moveCardToColumn forwards id and target column to the backend", async () => {
    expect(await data.moveCardToColumn("card-x", "col-active")).toBe(true);
    expect(state.moveCardToColumnCalls).toEqual([
      { id: "card-x", columnId: "col-active" },
    ]);
  });

  it("updateCardScore forwards delta to the backend", async () => {
    await data.updateCardScore("card-x", 1);
    expect(state.updateCardScoreCalls).toEqual([{ id: "card-x", delta: 1 }]);
  });

  it("filterByTag captures matching cards by tag", async () => {
    state.cardsByColumn = new Map([
      [
        "col-active",
        [
          makeCard("card-1", "col-active", { content: "#alpha note" }),
          makeCard("card-2", "col-active", { content: "no tag" }),
          makeCard("card-3", "col-active", { content: "#alpha and #beta" }),
        ],
      ],
    ]);
    await data.loadCardsForColumns();

    data.filterByTag("alpha");

    expect(data.activeTagFilter).toBe("alpha");
    expect(data.filteredCardIds?.has("card-1")).toBe(true);
    expect(data.filteredCardIds?.has("card-2")).toBe(false);
    expect(data.filteredCardIds?.has("card-3")).toBe(true);
  });

  it("clearTagFilter resets active filter and matching ids", async () => {
    data.filterByTag("alpha");
    data.clearTagFilter();
    expect(data.activeTagFilter).toBeNull();
    expect(data.filteredCardIds).toBeNull();
  });

  it("getTagSuggestions returns suggestions from the backend", async () => {
    const suggestions = await data.getTagSuggestions("al");
    expect(suggestions[0].name).toBe("al-suggestion");
  });

  it("getTagSuggestions returns empty array when no current deck", async () => {
    data.currentDeck = null;
    expect(await data.getTagSuggestions("any")).toEqual([]);
  });

  it("loadDeckTags hits the backend when a deck is selected", async () => {
    const before = state.getTagsByDeckCalls;
    await data.loadDeckTags();
    expect(state.getTagsByDeckCalls).toBeGreaterThan(before);
  });

  it("loadDeckTags is a no-op when no current deck", async () => {
    data.currentDeck = null;
    const before = state.getTagsByDeckCalls;
    await data.loadDeckTags();
    expect(state.getTagsByDeckCalls).toBe(before);
  });

  it("getTrashItems returns empty when no current deck", async () => {
    data.currentDeck = null;
    expect(await data.getTrashItems()).toEqual([]);
  });

  it("reloadColumns is a no-op when no current deck", async () => {
    data.currentDeck = null;
    await expect(data.reloadColumns()).resolves.toBeUndefined();
  });
});

describe("DeckData onboarding", () => {
  beforeEach(() => {
    resetState();
  });

  it("creates a Getting Started deck with seed columns and cards when no decks exist", async () => {
    const fresh = new DeckData();
    await fresh.init();

    expect(fresh.decks.length).toBe(1);
    expect(fresh.decks[0].name).toBe("Getting Started");
  });

  it("restoreOnboardingDeck prepends and selects a fresh deck without removing existing decks", async () => {
    state.decks = [makeDeck("existing-deck", "My Notes")];

    const fresh = new DeckData();
    await fresh.init();
    expect(fresh.decks.length).toBe(1);

    const restored = await fresh.restoreOnboardingDeck();

    expect(restored).not.toBeNull();
    expect(restored?.name).toBe("Getting Started");
    // Prepended, existing deck preserved.
    expect(fresh.decks.length).toBe(2);
    expect(fresh.decks[0].id).toBe(restored?.id);
    expect(fresh.decks.some((d) => d.id === "existing-deck")).toBe(true);
    // Newly restored deck becomes the current one.
    expect(fresh.currentDeck?.id).toBe(restored?.id);
  });

  it("falls back to first deck when stored last-deck-id no longer exists", async () => {
    state.decks = [makeDeck("known-deck")];
    state.columns = [makeColumn("col-active", "known-deck")];
    state.cardsByColumn = new Map([["col-active", []]]);
    localStorage.setItem("jot-deck:last-deck-id", "missing-deck");

    const fresh = new DeckData();
    await fresh.init();

    expect(fresh.currentDeck?.id).toBe("known-deck");
  });

  it("restores last-deck-id when present", async () => {
    state.decks = [makeDeck("first"), makeDeck("second")];

    localStorage.setItem("jot-deck:last-deck-id", "second");

    const fresh = new DeckData();
    await fresh.init();

    expect(fresh.currentDeck?.id).toBe("second");
  });
});
