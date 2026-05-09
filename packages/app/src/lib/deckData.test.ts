import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Card, Column, Deck } from "$lib/types";
import type { DatabaseBackend } from "$lib/db";

/**
 * In-test mock backend. Returns whatever each test populates on these arrays.
 * We mock $lib/db before importing DeckData so the singleton picks up our mock.
 */
const state = {
  decks: [] as Deck[],
  columns: [] as Column[],
  deletedColumns: [] as Column[],
  cardsByColumn: new Map<string, Card[]>(),
  deletedCards: [] as Card[],
  restoreCardCalls: [] as string[],
  restoreColumnCalls: [] as string[],
};

const mockBackend: Partial<DatabaseBackend> = {
  getAllDecks: async () => state.decks,
  getColumnsByDeck: async () => state.columns,
  getCardsByColumn: async (columnId: string) =>
    state.cardsByColumn.get(columnId) ?? [],
  getTagsByDeck: async () => [],
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
};

vi.mock("$lib/db", () => ({
  getDatabase: async () => mockBackend,
}));

const { DeckData } = await import("./deckData.svelte");

function makeDeck(id: string, name = id): Deck {
  return {
    id,
    name,
    sort_order: "created_desc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeColumn(id: string, deckId: string, deletedAt?: string): Column {
  return {
    id,
    deck_id: deckId,
    name: `${id}-name`,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: deletedAt ?? null,
  };
}

function makeCard(
  id: string,
  columnId: string,
  options: { deletedAt?: string; deletedWithColumn?: boolean; content?: string } = {},
): Card {
  return {
    id,
    column_id: columnId,
    content: options.content ?? `${id} content`,
    score: 0,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: options.deletedAt ?? null,
    deleted_with_column: options.deletedWithColumn ?? false,
  };
}

describe("DeckData trash", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-active", "deck-1")];
    state.deletedColumns = [];
    state.cardsByColumn = new Map([["col-active", []]]);
    state.deletedCards = [];
    state.restoreCardCalls = [];
    state.restoreColumnCalls = [];

    data = new DeckData();
    await data.init();
  });

  it("returns empty trash when nothing is deleted", async () => {
    const items = await data.getTrashItems();
    expect(items).toEqual([]);
  });

  it("merges deleted columns and cards in deleted_at descending order", async () => {
    state.deletedColumns = [
      makeColumn("col-old", "deck-1", "2026-05-01T10:00:00Z"),
      makeColumn("col-new", "deck-1", "2026-05-03T10:00:00Z"),
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
      makeColumn("col-deleted", "deck-1", "2026-05-01T10:00:00Z"),
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
      makeColumn("col-gone", "deck-1", "2026-05-01T10:00:00Z"),
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
    expect(card!.type).toBe("card");
    if (card!.type === "card") {
      expect(card.columnName).toBe("col-gone-name");
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
      makeColumn("col-x", "deck-1", "2026-05-02T10:00:00Z"),
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
});
