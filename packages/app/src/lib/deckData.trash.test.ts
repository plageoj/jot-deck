import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeCard, makeColumn } from "./__fixtures__/models";
import { deckState, seedSingleDeck } from "./__fixtures__/deckDataBackend";

// DeckData trash: listing soft-deleted columns/cards and restoring them,
// including the tag refresh and tag-filter reapplication after a restore.

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/deckDataBackend");
  return { getDatabase: async () => mockBackend, isTauri: () => false };
});

const { DeckData } = await import("./deckData.svelte");

describe("DeckData trash", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    seedSingleDeck();
    data = new DeckData();
    await data.init();
  });

  it("returns empty trash when nothing is deleted", async () => {
    const items = await data.getTrashItems();
    expect(items).toEqual([]);
  });

  it("getTrashItems returns empty when no current deck", async () => {
    data.currentDeck = null;
    expect(await data.getTrashItems()).toEqual([]);
  });

  it("merges deleted columns and cards in deleted_at descending order", async () => {
    deckState.deletedColumns = [
      makeColumn("col-old", "deck-1", { deletedAt: "2026-05-01T10:00:00Z" }),
      makeColumn("col-new", "deck-1", { deletedAt: "2026-05-03T10:00:00Z" }),
    ];
    deckState.deletedCards = [
      makeCard("card-mid", "col-active", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const items = await data.getTrashItems();

    expect(items.map((i) => i.id)).toEqual(["col-new", "card-mid", "col-old"]);
    expect(items[0].type).toBe("column");
    expect(items[1].type).toBe("card");
  });

  it("excludes cards deleted via cascade (deleted_with_column)", async () => {
    deckState.deletedColumns = [
      makeColumn("col-deleted", "deck-1", { deletedAt: "2026-05-01T10:00:00Z" }),
    ];
    deckState.deletedCards = [
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
    deckState.deletedColumns = [
      makeColumn("col-gone", "deck-1", { deletedAt: "2026-05-01T10:00:00Z" }),
    ];
    deckState.deletedCards = [
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

  it("breaks deleted_at ties deterministically by id (descending)", async () => {
    // Same deletedAt — order must be stable and id-descending so undo picks
    // the same item every time, regardless of source-table merge order.
    const sameTs = "2026-05-02T10:00:00Z";
    deckState.deletedColumns = [makeColumn("id-c", "deck-1", { deletedAt: sameTs })];
    deckState.deletedCards = [
      makeCard("id-a", "col-active", { deletedAt: sameTs }),
      makeCard("id-b", "col-active", { deletedAt: sameTs }),
    ];

    // Mutate input order (insert column second, swap card order) — sort
    // should still produce the same id-desc order.
    const items = await data.getTrashItems();
    expect(items.map((i) => i.id)).toEqual(["id-c", "id-b", "id-a"]);

    deckState.deletedColumns = [makeColumn("id-c", "deck-1", { deletedAt: sameTs })];
    deckState.deletedCards = [
      makeCard("id-b", "col-active", { deletedAt: sameTs }),
      makeCard("id-a", "col-active", { deletedAt: sameTs }),
    ];
    const items2 = await data.getTrashItems();
    expect(items2.map((i) => i.id)).toEqual(["id-c", "id-b", "id-a"]);
  });

  it("restoreTrashItem dispatches to restoreCard for cards", async () => {
    deckState.deletedCards = [
      makeCard("card-1", "col-active", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const [item] = await data.getTrashItems();
    const ok = await data.restoreTrashItem(item);

    expect(ok).toBe(true);
    expect(deckState.restoreCardCalls).toEqual(["card-1"]);
    expect(deckState.restoreColumnCalls).toEqual([]);
  });

  it("restoreTrashItem dispatches to restoreColumn for columns", async () => {
    deckState.deletedColumns = [
      makeColumn("col-x", "deck-1", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const [item] = await data.getTrashItems();
    const ok = await data.restoreTrashItem(item);

    expect(ok).toBe(true);
    expect(deckState.restoreColumnCalls).toEqual(["col-x"]);
    expect(deckState.restoreCardCalls).toEqual([]);
  });

  it("refreshes deck tags after restoring an item", async () => {
    deckState.deletedCards = [
      makeCard("card-1", "col-active", { deletedAt: "2026-05-02T10:00:00Z" }),
    ];

    const callsBefore = deckState.getTagsByDeckCalls;
    const [item] = await data.getTrashItems();
    await data.restoreTrashItem(item);

    expect(deckState.getTagsByDeckCalls).toBeGreaterThan(callsBefore);
  });

  it("re-applies an active tag filter after restoring", async () => {
    // Active card with #todo so the filter resolves to a non-empty set.
    deckState.cardsByColumn = new Map([
      [
        "col-active",
        [makeCard("card-active", "col-active", { content: "#todo task" })],
      ],
    ]);
    deckState.deletedCards = [
      makeCard("card-deleted", "col-active", {
        deletedAt: "2026-05-02T10:00:00Z",
        content: "#todo old",
      }),
    ];

    // Sync DeckData's cardsByColumn with the new mock content above.
    await data.refreshDeck();
    data.filterByTag("todo");
    expect(data.filteredCardIds?.has("card-active")).toBe(true);

    // Simulate the deleted card returning to col-active after restore.
    deckState.cardsByColumn = new Map([
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
