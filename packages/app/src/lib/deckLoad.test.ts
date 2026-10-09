import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { Card, Column, Deck, Tag } from "#lib/types.ts";
import type { DatabaseBackend } from "#lib/db/index.ts";
import { makeCard, makeColumn, makeDeck } from "./__fixtures__/models";

// Snapshot load/commit behavior of DeckData (#74): every deck load reads a
// complete snapshot off-state and commits it only while it is the latest load
// for the still-selected deck.

type Stage = "columns" | "cards" | "tags";

interface DeckContent {
  columns: Column[];
  cards: Card[];
  tags: Tag[];
}

/** Per-deck backend content. Column ids are `<deckId>/col` so card requests
 * can tell which deck they belong to. `label` distinguishes data versions. */
function fixture(deckId: string, label = deckId): DeckContent {
  const columnId = `${deckId}/col`;
  return {
    columns: [makeColumn(columnId, deckId)],
    cards: [makeCard(`${label}/card`, columnId, { content: `#${label}` })],
    tags: [{ id: `${label}/tag`, name: label }],
  };
}

interface Gate {
  promise: Promise<void>;
  release: () => void;
  fail: (e: Error) => void;
}

let decks: Deck[] = [];
let content: Record<string, DeckContent> = {};
/** Pending gates keyed by `${stage}:${deckId}`; one fetch waits on each. */
let gates = new Map<string, Gate>();

function hold(stage: Stage, deckId: string): Gate {
  let release!: () => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  // A gate failed before anyone awaits it must not count as unhandled.
  promise.catch(() => {});
  const gate = { promise, release, fail };
  gates.set(`${stage}:${deckId}`, gate);
  return gate;
}

async function pass(stage: Stage, deckId: string): Promise<void> {
  const key = `${stage}:${deckId}`;
  const gate = gates.get(key);
  if (!gate) return;
  gates.delete(key);
  await gate.promise;
}

const mockBackend: Partial<DatabaseBackend> = {
  getAllDecks: async () => decks,
  getColumnsByDeck: async (deckId) => {
    await pass("columns", deckId);
    return content[deckId].columns;
  },
  getCardsByColumn: async (columnId) => {
    const deckId = columnId.split("/")[0];
    await pass("cards", deckId);
    return content[deckId].cards;
  },
  getTagsByDeck: async (deckId) => {
    await pass("tags", deckId);
    return content[deckId].tags;
  },
};

vi.mock("#lib/db/index.ts", () => ({
  getDatabase: async () => mockBackend,
  isTauri: () => false,
}));

const { DeckData } = await import("./deckData.svelte");

describe("DeckData deck load snapshots", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    localStorage.clear();
    gates = new Map();
    decks = [makeDeck("deck-1"), makeDeck("deck-2"), makeDeck("deck-3")];
    content = {
      "deck-1": fixture("deck-1"),
      "deck-2": fixture("deck-2"),
      "deck-3": fixture("deck-3"),
    };
    data = new DeckData();
    await data.init();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function expectBoardOf(deckId: string, label = deckId) {
    expect(data.loadedDeckId).toBe(deckId);
    expect(data.columns.map((c) => c.id)).toEqual([`${deckId}/col`]);
    expect(Object.keys(data.cardsByColumn)).toEqual([`${deckId}/col`]);
    expect(data.cardsByColumn[`${deckId}/col`].map((c) => c.id)).toEqual([
      `${label}/card`,
    ]);
    expect(data.deckTags.map((t) => t.name)).toEqual([label]);
  }

  it.each<Stage>(["columns", "cards", "tags"])(
    "a deck switch while %s are loading never lets the old deck commit",
    async (stage) => {
      const gate = hold(stage, "deck-2");
      const stale = data.selectDeck(makeDeck("deck-2"));
      await data.selectDeck(makeDeck("deck-3"));
      expectBoardOf("deck-3");

      gate.release();
      await expect(stale).resolves.toBe(false);

      expect(data.currentDeck?.id).toBe("deck-3");
      expectBoardOf("deck-3");
    },
  );

  it.each<Stage>(["columns", "cards", "tags"])(
    "nothing is committed while %s are still loading",
    async (stage) => {
      const gate = hold(stage, "deck-2");
      const loading = data.selectDeck(makeDeck("deck-2"));
      await vi.waitFor(() => expect(gates.has(`${stage}:deck-2`)).toBe(false));

      expect(data.loadedDeckId).toBeNull();
      expect(data.columns).toEqual([]);
      expect(data.cardsByColumn).toEqual({});
      expect(data.deckTags).toEqual([]);

      gate.release();
      await expect(loading).resolves.toBe(true);
      expectBoardOf("deck-2");
    },
  );

  it("overlapping refreshes of the same deck commit only the latest", async () => {
    const gate = hold("cards", "deck-1");
    const older = data.refreshDeck();
    await vi.waitFor(() => expect(gates.has("cards:deck-1")).toBe(false));

    content["deck-1"] = fixture("deck-1", "newer");
    await expect(data.refreshDeck()).resolves.toBe(true);
    expectBoardOf("deck-1", "newer");

    // The older request finishes last, with older data, and is discarded.
    content["deck-1"] = fixture("deck-1", "older");
    gate.release();
    await expect(older).resolves.toBe(false);
    expectBoardOf("deck-1", "newer");
  });

  it("a failed deck switch leaves the new deck empty with a load error", async () => {
    hold("cards", "deck-2").fail(new Error("db gone"));

    await expect(data.selectDeck(makeDeck("deck-2"))).resolves.toBe(false);

    expect(data.currentDeck?.id).toBe("deck-2");
    expect(data.isDeckLoaded).toBe(false);
    expect(data.loadedDeckId).toBeNull();
    expect(data.columns).toEqual([]);
    expect(data.cardsByColumn).toEqual({});
    expect(data.deckLoadError).toContain("Failed to load deck");
    expect(data.error).toBeNull();
  });

  it("reloadDeck recovers a failed deck switch and clears the load error", async () => {
    hold("columns", "deck-2").fail(new Error("db gone"));
    await data.selectDeck(makeDeck("deck-2"));
    expect(data.deckLoadError).not.toBeNull();

    await expect(data.reloadDeck()).resolves.toBe(true);

    expect(data.deckLoadError).toBeNull();
    expect(data.isDeckLoaded).toBe(true);
    expectBoardOf("deck-2");
  });

  it("a failed refresh of a loaded deck keeps the board and raises a banner error", async () => {
    const columns = data.columns;
    const cards = data.cardsByColumn;
    hold("tags", "deck-1").fail(new Error("db gone"));

    await expect(data.refreshDeck()).resolves.toBe(false);

    expect(data.columns).toBe(columns);
    expect(data.cardsByColumn).toBe(cards);
    expect(data.isDeckLoaded).toBe(true);
    expect(data.deckLoadError).toBeNull();
    expect(data.error).toContain("Failed to reload deck");
  });

  it("a superseded load that fails reports nothing to the user", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = hold("columns", "deck-2");
    const stale = data.selectDeck(makeDeck("deck-2"));
    await data.selectDeck(makeDeck("deck-3"));

    gate.fail(new Error("db gone"));
    await stale;

    expect(data.error).toBeNull();
    expect(data.deckLoadError).toBeNull();
    expectBoardOf("deck-3");
    expect(consoleError).toHaveBeenCalled();
  });

  it("switching decks clears the previous board immediately", async () => {
    const gate = hold("columns", "deck-2");
    const loading = data.selectDeck(makeDeck("deck-2"));

    expect(data.columns).toEqual([]);
    expect(data.cardsByColumn).toEqual({});
    expect(data.deckTags).toEqual([]);

    gate.release();
    await loading;
  });

  it("the first commit for a deck clears a stale error banner", async () => {
    data.error = "Failed to update score: boom";
    await data.selectDeck(makeDeck("deck-2"));
    expect(data.error).toBeNull();
  });

  it("a same-deck refresh keeps an unrelated error banner", async () => {
    data.error = "Failed to update score: boom";
    await data.refreshDeck();
    expect(data.error).toBe("Failed to update score: boom");
  });

  it("re-applies the active tag filter on commit", async () => {
    data.filterByTag("newer");
    expect(data.filteredCardIds?.size).toBe(0);

    content["deck-1"] = fixture("deck-1", "newer");
    await data.refreshDeck();

    expect(data.filteredCardIds?.has("newer/card")).toBe(true);
  });

  it("a failed deck-list load is a load error that reloadDeck retries", async () => {
    vi.spyOn(mockBackend, "getAllDecks").mockRejectedValueOnce(new Error("locked"));
    const fresh = new DeckData();
    await fresh.init();

    expect(fresh.deckLoadError).toContain("Failed to load decks");
    expect(fresh.currentDeck).toBeNull();

    await expect(fresh.reloadDeck()).resolves.toBe(true);
    expect(fresh.deckLoadError).toBeNull();
    expect(fresh.isDeckLoaded).toBe(true);
  });
});
