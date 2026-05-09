import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Card, Column, Deck } from "$lib/types";
import type { DatabaseBackend } from "$lib/db";

const state = {
  decks: [] as Deck[],
  columns: [] as Column[],
  cardsByColumn: new Map<string, Card[]>(),
  tagsByDeck: [] as { id: string; name: string }[],
};

const mockBackend: Partial<DatabaseBackend> = {
  getAllDecks: async () => state.decks,
  getColumnsByDeck: async () => state.columns,
  getCardsByColumn: async (columnId: string) =>
    state.cardsByColumn.get(columnId) ?? [],
  getTagsByDeck: async () => state.tagsByDeck,
};

vi.mock("$lib/db", () => ({
  getDatabase: async () => mockBackend,
}));

const { DeckData } = await import("./deckData.svelte");
const { FocusManager } = await import("./focusManager.svelte");

function makeDeck(id: string): Deck {
  return {
    id,
    name: id,
    sort_order: "created_desc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeColumn(id: string, deckId: string, position = 0): Column {
  return {
    id,
    deck_id: deckId,
    name: `${id}-name`,
    position,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
}

function makeCard(id: string, columnId: string): Card {
  return {
    id,
    column_id: columnId,
    content: `${id} content`,
    score: 0,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    deleted_with_column: false,
  };
}

describe("FocusManager persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    state.decks = [];
    state.columns = [];
    state.cardsByColumn = new Map();
    state.tagsByDeck = [];
  });

  it("persists focusedColumnIndex and lastFocusedCardByColumn per deck", async () => {
    const data = new DeckData();
    const focus = new FocusManager(data);

    focus.setCurrentDeck("deck-1");
    focus.focusedColumnIndex = 2;
    focus.lastFocusedCardByColumn["col-a"] = 5;
    focus.persistCurrent();

    const raw = localStorage.getItem("jot-deck:focus:deck-1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.focusedColumnIndex).toBe(2);
    expect(parsed.lastFocusedCardByColumn["col-a"]).toBe(5);
  });

  it("persists focusMode (column/card) and reduces edit/command to column", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);

    focus.setCurrentDeck("deck-1");
    focus.focusMode = "card";
    focus.persistCurrent();
    expect(JSON.parse(localStorage.getItem("jot-deck:focus:deck-1")!).focusMode).toBe("card");

    focus.focusMode = "edit";
    focus.persistCurrent();
    expect(JSON.parse(localStorage.getItem("jot-deck:focus:deck-1")!).focusMode).toBe("column");

    focus.focusMode = "command";
    focus.persistCurrent();
    expect(JSON.parse(localStorage.getItem("jot-deck:focus:deck-1")!).focusMode).toBe("column");
  });

  it("clampToLoadedDeck restores card mode when the focused column has cards", async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-x", "deck-1")];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("c1", "col-x"), makeCard("c2", "col-x")]],
    ]);

    localStorage.setItem(
      "jot-deck:focus:deck-1",
      JSON.stringify({
        focusedColumnIndex: 0,
        lastFocusedCardByColumn: { "col-x": 1 },
        focusMode: "card",
      }),
    );

    const data = new DeckData();
    await data.init();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    // Mode is parked on `column` until clamp runs.
    expect(focus.focusMode).toBe("column");
    focus.clampToLoadedDeck();

    expect(focus.focusMode).toBe("card");
    expect(focus.focusedCardIndex).toBe(1);
  });

  it("clampToLoadedDeck falls back to column mode when restored card column is empty", async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-empty", "deck-1")];
    state.cardsByColumn = new Map([["col-empty", []]]);

    localStorage.setItem(
      "jot-deck:focus:deck-1",
      JSON.stringify({
        focusedColumnIndex: 0,
        lastFocusedCardByColumn: {},
        focusMode: "card",
      }),
    );

    const data = new DeckData();
    await data.init();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.clampToLoadedDeck();

    expect(focus.focusMode).toBe("column");
  });

  it("includes the current focused card index for the focused column when persisting", async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-x", "deck-1", 0), makeColumn("col-y", "deck-1", 1)];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("c1", "col-x"), makeCard("c2", "col-x")]],
      ["col-y", [makeCard("c3", "col-y"), makeCard("c4", "col-y"), makeCard("c5", "col-y")]],
    ]);

    const data = new DeckData();
    await data.init();

    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.focusedColumnIndex = 1; // col-y
    focus.focusedCardIndex = 2; // c5
    focus.persistCurrent();

    const parsed = JSON.parse(localStorage.getItem("jot-deck:focus:deck-1")!);
    expect(parsed.focusedColumnIndex).toBe(1);
    expect(parsed.lastFocusedCardByColumn["col-y"]).toBe(2);
  });

  it("setCurrentDeck saves prior deck state and loads new deck state", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);

    focus.setCurrentDeck("deck-A");
    focus.focusedColumnIndex = 3;
    focus.lastFocusedCardByColumn["col-1"] = 7;
    focus.persistCurrent();

    // Pre-seed state for deck-B.
    localStorage.setItem(
      "jot-deck:focus:deck-B",
      JSON.stringify({
        focusedColumnIndex: 1,
        lastFocusedCardByColumn: { "col-2": 4 },
      }),
    );

    focus.setCurrentDeck("deck-B");
    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.lastFocusedCardByColumn["col-2"]).toBe(4);

    // Switching back restores deck-A state.
    focus.setCurrentDeck("deck-A");
    expect(focus.focusedColumnIndex).toBe(3);
    expect(focus.lastFocusedCardByColumn["col-1"]).toBe(7);
  });

  it("setCurrentDeck resets to defaults when no saved state exists", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 5;
    focus.lastFocusedCardByColumn["col-stale"] = 9;

    focus.setCurrentDeck("fresh-deck");

    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.lastFocusedCardByColumn).toEqual({});
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("clampToLoadedDeck applies saved card index for the restored column", async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-x", "deck-1", 0), makeColumn("col-y", "deck-1", 1)];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("c1", "col-x")]],
      ["col-y", [makeCard("c2", "col-y"), makeCard("c3", "col-y"), makeCard("c4", "col-y")]],
    ]);

    localStorage.setItem(
      "jot-deck:focus:deck-1",
      JSON.stringify({
        focusedColumnIndex: 1,
        lastFocusedCardByColumn: { "col-y": 2 },
      }),
    );

    const data = new DeckData();
    await data.init();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.clampToLoadedDeck();

    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.focusedCardIndex).toBe(2);
  });

  it("clampToLoadedDeck clamps focusedColumnIndex to available columns", async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-only", "deck-1", 0)];
    state.cardsByColumn = new Map([["col-only", [makeCard("c1", "col-only")]]]);

    localStorage.setItem(
      "jot-deck:focus:deck-1",
      JSON.stringify({
        focusedColumnIndex: 9, // out of range
        lastFocusedCardByColumn: {},
      }),
    );

    const data = new DeckData();
    await data.init();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.clampToLoadedDeck();

    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("clampToLoadedDeck clamps stale card index against the actual card list", async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-x", "deck-1")];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("c1", "col-x"), makeCard("c2", "col-x")]],
    ]);

    localStorage.setItem(
      "jot-deck:focus:deck-1",
      JSON.stringify({
        focusedColumnIndex: 0,
        lastFocusedCardByColumn: { "col-x": 99 },
      }),
    );

    const data = new DeckData();
    await data.init();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.clampToLoadedDeck();

    // Stale saved index falls back to last available card (length-1).
    expect(focus.focusedCardIndex).toBe(1);
  });

  it("clearStateFor removes persisted focus state for a deck", () => {
    localStorage.setItem(
      "jot-deck:focus:doomed",
      JSON.stringify({ focusedColumnIndex: 4, lastFocusedCardByColumn: {} }),
    );
    expect(localStorage.getItem("jot-deck:focus:doomed")).not.toBeNull();

    FocusManager.clearStateFor("doomed");

    expect(localStorage.getItem("jot-deck:focus:doomed")).toBeNull();
  });

  it("ignores corrupted saved state", () => {
    localStorage.setItem("jot-deck:focus:bad", "{ not json");
    const data = new DeckData();
    const focus = new FocusManager(data);

    focus.setCurrentDeck("bad");

    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.lastFocusedCardByColumn).toEqual({});
  });
});

describe("FocusManager rapid deck switch race condition", () => {
  const shouldClamp = FocusManager.shouldClampForLoadedDeck;

  beforeEach(() => {
    localStorage.clear();
    state.decks = [];
    state.columns = [];
    state.cardsByColumn = new Map();
    state.tagsByDeck = [];
  });

  it("skips clampToLoadedDeck when loadedDeckId belongs to a stale deck switch", () => {
    expect(
      shouldClamp({
        loaded: "deck-B",
        restoredForDeckId: null,
        currentDeckId: "deck-C",
      }),
    ).toBe(false);
  });

  it("runs clampToLoadedDeck once loadedDeckId catches up to the current deck", () => {
    expect(
      shouldClamp({
        loaded: "deck-C",
        restoredForDeckId: null,
        currentDeckId: "deck-C",
      }),
    ).toBe(true);
  });

  it("does not re-run clampToLoadedDeck for a deck that has already been restored", () => {
    expect(
      shouldClamp({
        loaded: "deck-C",
        restoredForDeckId: "deck-C",
        currentDeckId: "deck-C",
      }),
    ).toBe(false);
  });

  it("preserves restored focus when stale loadedDeckId would have clamped against wrong columns", () => {
    // Saved state: deck-C had focus on column index 4.
    localStorage.setItem(
      "jot-deck:focus:deck-C",
      JSON.stringify({
        focusedColumnIndex: 4,
        lastFocusedCardByColumn: {},
        focusMode: "column",
      }),
    );

    const data = new DeckData();
    const focus = new FocusManager(data);

    // User opens deck-B, then quickly switches to deck-C before deck-B finishes
    // loading. Both setCurrentDeck calls happen synchronously when each
    // currentDeck change is observed.
    focus.setCurrentDeck("deck-B");
    focus.setCurrentDeck("deck-C");
    expect(focus.focusedColumnIndex).toBe(4);

    // Now deck-B's selectDeck finishes after deck-C was already selected,
    // briefly setting columns to deck-B's (only 2) and loadedDeckId to "deck-B".
    data.columns = [makeColumn("b-col-1", "deck-B"), makeColumn("b-col-2", "deck-B")];
    data.cardsByColumn = { "b-col-1": [], "b-col-2": [] };
    data.currentDeck = makeDeck("deck-C");

    // Page's guard would skip clamp since loaded ("deck-B") !== currentDeck ("deck-C").
    const shouldRun = shouldClamp({
      loaded: "deck-B",
      restoredForDeckId: null,
      currentDeckId: data.currentDeck.id,
    });
    expect(shouldRun).toBe(false);

    // Sanity check: had the guard been absent, clamp would have corrupted
    // focusedColumnIndex by capping it at deck-B's length-1 (=1).
    expect(focus.focusedColumnIndex).toBe(4);

    // Once deck-C finishes loading, clamp can run safely.
    data.columns = [
      makeColumn("c-col-1", "deck-C"),
      makeColumn("c-col-2", "deck-C"),
      makeColumn("c-col-3", "deck-C"),
      makeColumn("c-col-4", "deck-C"),
      makeColumn("c-col-5", "deck-C"),
    ];
    data.cardsByColumn = {
      "c-col-1": [],
      "c-col-2": [],
      "c-col-3": [],
      "c-col-4": [],
      "c-col-5": [],
    };
    expect(
      shouldClamp({
        loaded: "deck-C",
        restoredForDeckId: null,
        currentDeckId: "deck-C",
      }),
    ).toBe(true);
    focus.clampToLoadedDeck();
    expect(focus.focusedColumnIndex).toBe(4);
  });

  it("would corrupt focus index without the guard (regression scenario)", () => {
    // Restored state targets index 4, but columns array is the wrong deck's
    // (only 2 entries). Without the page-level guard, clampToLoadedDeck
    // collapses focusedColumnIndex to 1 — losing the saved value.
    localStorage.setItem(
      "jot-deck:focus:deck-C",
      JSON.stringify({
        focusedColumnIndex: 4,
        lastFocusedCardByColumn: {},
        focusMode: "column",
      }),
    );

    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-C");

    data.columns = [makeColumn("b-col-1", "deck-B"), makeColumn("b-col-2", "deck-B")];
    data.cardsByColumn = { "b-col-1": [], "b-col-2": [] };

    focus.clampToLoadedDeck();

    expect(focus.focusedColumnIndex).toBe(1);
  });
});
