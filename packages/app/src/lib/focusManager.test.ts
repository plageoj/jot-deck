import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Card, Column, Deck } from "$lib/types";
import type { DatabaseBackend } from "$lib/db";
import { makeCard, makeColumn, makeDeck } from "./__fixtures__/models";

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
const { FocusManager, FOCUS_STATE_PREFIX } = await import("./focusManager.svelte");

const focusKey = (deckId: string) => FOCUS_STATE_PREFIX + deckId;

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

    const raw = localStorage.getItem(focusKey("deck-1"));
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
    expect(JSON.parse(localStorage.getItem(focusKey("deck-1"))!).focusMode).toBe("card");

    focus.focusMode = "edit";
    focus.persistCurrent();
    expect(JSON.parse(localStorage.getItem(focusKey("deck-1"))!).focusMode).toBe("column");

    focus.focusMode = "command";
    focus.persistCurrent();
    expect(JSON.parse(localStorage.getItem(focusKey("deck-1"))!).focusMode).toBe("column");
  });

  it("clampToLoadedDeck restores card mode when the focused column has cards", async () => {
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-x", "deck-1")];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("c1", "col-x"), makeCard("c2", "col-x")]],
    ]);

    localStorage.setItem(
      focusKey("deck-1"),
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
      focusKey("deck-1"),
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
    state.columns = [makeColumn("col-x", "deck-1", { position: 0 }), makeColumn("col-y", "deck-1", { position: 1 })];
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

    const parsed = JSON.parse(localStorage.getItem(focusKey("deck-1"))!);
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
      focusKey("deck-B"),
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
    state.columns = [makeColumn("col-x", "deck-1", { position: 0 }), makeColumn("col-y", "deck-1", { position: 1 })];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("c1", "col-x")]],
      ["col-y", [makeCard("c2", "col-y"), makeCard("c3", "col-y"), makeCard("c4", "col-y")]],
    ]);

    localStorage.setItem(
      focusKey("deck-1"),
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
    state.columns = [makeColumn("col-only", "deck-1", { position: 0 })];
    state.cardsByColumn = new Map([["col-only", [makeCard("c1", "col-only")]]]);

    localStorage.setItem(
      focusKey("deck-1"),
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
      focusKey("deck-1"),
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
      focusKey("doomed"),
      JSON.stringify({ focusedColumnIndex: 4, lastFocusedCardByColumn: {} }),
    );
    expect(localStorage.getItem(focusKey("doomed"))).not.toBeNull();

    FocusManager.clearStateFor("doomed");

    expect(localStorage.getItem(focusKey("doomed"))).toBeNull();
  });

  it("ignores corrupted saved state", () => {
    localStorage.setItem(focusKey("bad"), "{ not json");
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
      focusKey("deck-C"),
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
      focusKey("deck-C"),
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

  it("shouldClampForLoadedDeck returns false when no deck has loaded yet", () => {
    expect(
      FocusManager.shouldClampForLoadedDeck({
        loaded: null,
        restoredForDeckId: null,
        currentDeckId: "deck-A",
      }),
    ).toBe(false);
  });
});

describe("FocusManager focus helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    state.decks = [];
    state.columns = [];
    state.cardsByColumn = new Map();
    state.tagsByDeck = [];
  });

  it("saveCurrentCardIndex stores focusedCardIndex under the focused column", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1"), makeColumn("col-y", "deck-1")];
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 1;
    focus.focusedCardIndex = 4;
    focus.saveCurrentCardIndex();

    expect(focus.lastFocusedCardByColumn["col-y"]).toBe(4);
    expect(focus.lastFocusedCardByColumn["col-x"]).toBeUndefined();
  });

  it("saveCurrentCardIndex is a no-op when focusedColumnIndex is out of range", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1")];
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 5;
    focus.focusedCardIndex = 2;
    focus.saveCurrentCardIndex();

    expect(focus.lastFocusedCardByColumn).toEqual({});
  });

  it("restoreCardIndex applies a saved index when it fits the card list", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1")];
    data.cardsByColumn = {
      "col-x": [makeCard("c1", "col-x"), makeCard("c2", "col-x"), makeCard("c3", "col-x")],
    };
    const focus = new FocusManager(data);

    focus.lastFocusedCardByColumn["col-x"] = 2;
    focus.focusedColumnIndex = 0;
    focus.restoreCardIndex();

    expect(focus.focusedCardIndex).toBe(2);
  });

  it("restoreCardIndex falls back to the last card when no saved index exists", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1")];
    data.cardsByColumn = {
      "col-x": [makeCard("c1", "col-x"), makeCard("c2", "col-x")],
    };
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 0;
    focus.restoreCardIndex();

    expect(focus.focusedCardIndex).toBe(1);
  });

  it("restoreCardIndex falls back to 0 when the column has no cards", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1")];
    data.cardsByColumn = { "col-x": [] };
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 7;
    focus.restoreCardIndex();

    expect(focus.focusedCardIndex).toBe(0);
  });

  it("restoreCardIndex is a no-op when focusedColumnIndex is out of range", () => {
    const data = new DeckData();
    data.columns = [];
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 3;
    focus.restoreCardIndex();

    expect(focus.focusedCardIndex).toBe(3);
  });

  it("startEdit sets the editing card id and switches to edit mode", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);

    focus.startEdit("card-7");

    expect(focus.editingCardId).toBe("card-7");
    expect(focus.focusMode).toBe("edit");
  });

  it("exitEdit clears editing id and returns to card mode", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.startEdit("card-7");

    focus.exitEdit();

    expect(focus.editingCardId).toBeNull();
    expect(focus.focusMode).toBe("card");
  });

  it("cancelEdit clears editingCardId without changing focus mode", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.startEdit("card-7");
    expect(focus.focusMode).toBe("edit");

    focus.cancelEdit();

    expect(focus.editingCardId).toBeNull();
    expect(focus.focusMode).toBe("edit");
  });

  it("openPalette captures previousFocusMode and switches to command mode", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.focusMode = "card";

    focus.openPalette("deck");

    expect(focus.activePalette).toBe("deck");
    expect(focus.focusMode).toBe("command");
    expect(focus.previousFocusMode).toBe("card");
  });

  it("openPalette is a no-op when already in command mode", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.focusMode = "card";
    focus.openPalette("deck");
    expect(focus.activePalette).toBe("deck");

    // Second call from within command mode should not overwrite the palette.
    focus.openPalette("trash");

    expect(focus.activePalette).toBe("deck");
  });

  it("openPalette closes the cheatsheet when opening a palette", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.showCheatsheet = true;
    focus.focusMode = "column";

    focus.openPalette("command");

    expect(focus.showCheatsheet).toBe(false);
  });

  it("closePalette restores previousFocusMode and clears the palette", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.focusMode = "card";
    focus.openPalette("command");

    focus.closePalette();

    expect(focus.activePalette).toBeNull();
    expect(focus.focusMode).toBe("card");
  });

  it("handleFocusColumn saves the current card index when switching columns", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1"), makeColumn("col-y", "deck-1")];
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 3;
    focus.handleFocusColumn(1);

    expect(focus.lastFocusedCardByColumn["col-x"]).toBe(3);
    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.focusMode).toBe("column");
  });

  it("handleFocusColumn does not save when the column is unchanged", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1")];
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 5;
    focus.handleFocusColumn(0);

    expect(focus.lastFocusedCardByColumn["col-x"]).toBeUndefined();
    expect(focus.focusMode).toBe("column");
  });

  it("handleFocusCard updates indices and saves when crossing columns", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1"), makeColumn("col-y", "deck-1")];
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 2;
    focus.handleFocusCard(1, 4);

    expect(focus.lastFocusedCardByColumn["col-x"]).toBe(2);
    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.focusedCardIndex).toBe(4);
    expect(focus.focusMode).toBe("card");
  });

  it("handleFocusCard does not save when staying in the same column", () => {
    const data = new DeckData();
    data.columns = [makeColumn("col-x", "deck-1")];
    const focus = new FocusManager(data);

    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 0;
    focus.handleFocusCard(0, 3);

    expect(focus.lastFocusedCardByColumn["col-x"]).toBeUndefined();
    expect(focus.focusedCardIndex).toBe(3);
    expect(focus.focusMode).toBe("card");
  });

  it("scrollToFocusedColumn invokes the registered callback with focusedColumnIndex", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    const calls: number[] = [];
    focus.onScrollToColumn = (i) => calls.push(i);

    focus.focusedColumnIndex = 3;
    focus.scrollToFocusedColumn();

    expect(calls).toEqual([3]);
  });

  it("scrollToFocusedColumn is a no-op when no callback is registered", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);

    expect(() => focus.scrollToFocusedColumn()).not.toThrow();
  });

  it("setCurrentDeck is a no-op when called with the already-active deck", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.focusedColumnIndex = 4;

    focus.setCurrentDeck("deck-1");

    // No reset to defaults — state is preserved.
    expect(focus.focusedColumnIndex).toBe(4);
  });

  it("setCurrentDeck(null) clears state and skips persistence loading", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.focusedColumnIndex = 5;
    focus.lastFocusedCardByColumn["col"] = 9;

    focus.setCurrentDeck(null);

    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.focusedCardIndex).toBe(0);
    expect(focus.lastFocusedCardByColumn).toEqual({});
  });

  it("persistCurrent does nothing when no current deck is set", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.focusedColumnIndex = 2;

    focus.persistCurrent();

    expect(localStorage.length).toBe(0);
  });

  it("clampToLoadedDeck resets focus when the deck has no columns", () => {
    const data = new DeckData();
    data.columns = [];
    const focus = new FocusManager(data);
    focus.setCurrentDeck("deck-1");
    focus.focusedColumnIndex = 5;
    focus.focusedCardIndex = 7;

    focus.clampToLoadedDeck();

    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.focusedCardIndex).toBe(0);
    expect(focus.focusMode).toBe("column");
  });

  it("loadState ignores entries with negative focusedColumnIndex and non-object cards", () => {
    localStorage.setItem(
      focusKey("bad-shape"),
      JSON.stringify({
        focusedColumnIndex: -3,
        lastFocusedCardByColumn: "not-an-object",
        focusMode: "card",
      }),
    );

    const data = new DeckData();
    const focus = new FocusManager(data);
    focus.setCurrentDeck("bad-shape");

    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.lastFocusedCardByColumn).toEqual({});
  });

  it("setCurrentDeck persists previous deck state on switch", () => {
    const data = new DeckData();
    const focus = new FocusManager(data);

    focus.setCurrentDeck("first");
    focus.focusedColumnIndex = 3;
    focus.lastFocusedCardByColumn["col"] = 8;

    focus.setCurrentDeck("second");

    const persisted = JSON.parse(localStorage.getItem(focusKey("first"))!);
    expect(persisted.focusedColumnIndex).toBe(3);
    expect(persisted.lastFocusedCardByColumn["col"]).toBe(8);
  });
});
