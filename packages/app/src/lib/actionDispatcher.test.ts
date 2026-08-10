import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Card, Column, Deck } from "$lib/types";
import type { DatabaseBackend } from "$lib/db";
import { makeCard, makeColumn, makeDeck } from "./__fixtures__/models";
import { updaterStore } from "./updater.svelte";

const state = {
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

const mockBackend: Partial<DatabaseBackend> = {
  getAllDecks: async () => state.decks,
  getColumnsByDeck: async () => state.columns,
  getCardsByColumn: async (columnId: string) =>
    state.cardsByColumn.get(columnId) ?? [],
  getTagsByDeck: async () => state.tagsByDeck,
  getDeletedColumns: async () => state.deletedColumns,
  getDeletedCards: async () => state.deletedCards,
  createColumn: async (params) => {
    state.createColumnCalls.push(params);
    const col = makeColumn(
      `created-${state.createColumnCalls.length}`,
      params.deck_id,
      { position: params.position },
    );
    state.columns = [...state.columns, col];
    state.cardsByColumn.set(col.id, []);
    return col;
  },
  restoreCard: async (id) => {
    state.restoreCardCalls.push(id);
    const idx = state.deletedCards.findIndex((c) => c.id === id);
    if (idx !== -1) state.deletedCards.splice(idx, 1);
    return makeCard(id, "");
  },
  restoreColumn: async (id) => {
    state.restoreColumnCalls.push(id);
    const idx = state.deletedColumns.findIndex((c) => c.id === id);
    if (idx !== -1) state.deletedColumns.splice(idx, 1);
    return makeColumn(id, "");
  },
  createCard: async (params) => {
    state.createCardCalls.push({
      column_id: params.column_id,
      content: params.content ?? "",
      position: params.position,
    });
    const card = makeCard(
      `created-card-${state.createCardCalls.length}`,
      params.column_id,
      { content: params.content, position: params.position },
    );
    const existing = state.cardsByColumn.get(params.column_id) ?? [];
    state.cardsByColumn.set(params.column_id, [...existing, card]);
    return card;
  },
  deleteColumn: async (id) => {
    state.deleteColumnCalls.push(id);
    state.columns = state.columns.filter((c) => c.id !== id);
  },
  deleteCard: async (id) => {
    state.deleteCardCalls.push(id);
    for (const [colId, cards] of state.cardsByColumn) {
      state.cardsByColumn.set(
        colId,
        cards.filter((c) => c.id !== id),
      );
    }
  },
  moveCard: async (id, position) => {
    state.moveCardCalls.push({ id, position });
    return makeCard(id, "", { position });
  },
  moveCardToColumn: async (id, columnId) => {
    state.moveCardToColumnCalls.push({ id, column_id: columnId });
    return makeCard(id, columnId);
  },
  updateCardScore: async (id, delta) => {
    state.updateCardScoreCalls.push({ id, delta });
    return makeCard(id, "");
  },
  moveColumn: async (id, position) => {
    state.moveColumnCalls.push({ id, position });
    return makeColumn(id, "", { position });
  },
  createDeck: async (params) => {
    state.createDeckCalls++;
    return makeDeck(`deck-new-${state.createDeckCalls}`, params.name ?? "Untitled");
  },
};

vi.mock("$lib/db", () => ({
  getDatabase: async () => mockBackend,
}));

const { DeckData } = await import("./deckData.svelte");
const { FocusManager } = await import("./focusManager.svelte");
const { ActionDispatcher } = await import("./actionDispatcher.svelte");

async function flushPromises() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function resetState() {
  state.decks = [];
  state.columns = [];
  state.cardsByColumn = new Map();
  state.tagsByDeck = [];
  state.createColumnCalls = [];
  state.deletedCards = [];
  state.deletedColumns = [];
  state.restoreCardCalls = [];
  state.restoreColumnCalls = [];
  state.createCardCalls = [];
  state.deleteColumnCalls = [];
  state.deleteCardCalls = [];
  state.moveCardCalls = [];
  state.moveCardToColumnCalls = [];
  state.updateCardScoreCalls = [];
  state.moveColumnCalls = [];
  state.createDeckCalls = 0;
  localStorage.clear();
}

function makeKeyEvent(opts: {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  target?: HTMLElement;
}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: opts.key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    cancelable: true,
  });
  Object.defineProperty(event, "target", {
    value: opts.target ?? document.body,
  });
  return event;
}

describe("ActionDispatcher with no columns loaded", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];

    data = new DeckData();
    await data.init();
    // After init the onboarding deck would normally have columns; force the
    // test scenario by clearing any loaded columns.
    data.columns = [];
    data.cardsByColumn = {};
    data.currentDeck = makeDeck("deck-1");

    focus = new FocusManager(data);
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("opens the deck palette via Ctrl+P even when no columns exist", () => {
    const event = makeKeyEvent({ key: "p", ctrl: true });
    dispatcher.handleKeydown(event);

    expect(focus.activePalette).toBe("deck");
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens settings via Ctrl+, even when no columns exist", () => {
    const event = makeKeyEvent({ key: ",", ctrl: true });
    dispatcher.handleKeydown(event);

    expect(focus.showSettings).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens the command palette via Ctrl+Shift+P when no columns exist", () => {
    const event = makeKeyEvent({ key: "P", ctrl: true, shift: true });
    dispatcher.handleKeydown(event);

    expect(focus.activePalette).toBe("command");
    expect(event.defaultPrevented).toBe(true);
  });

  it("creates a column with `c` when no columns exist", async () => {
    const event = makeKeyEvent({ key: "c" });
    dispatcher.handleKeydown(event);

    await flushPromises();

    expect(state.createColumnCalls.length).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("undoes the last delete via `u` when no columns exist", async () => {
    state.deletedCards = [
      {
        id: "card-1",
        column_id: "col-x",
        content: "x",
        score: 0,
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        deleted_at: "2026-05-01T00:00:00Z",
        deleted_with_column: false,
        locked_by: null,
        locked_at: null,
      },
    ];

    const event = makeKeyEvent({ key: "u" });
    dispatcher.handleKeydown(event);

    await flushPromises();

    expect(state.restoreCardCalls).toContain("card-1");
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores non-whitelisted column keys when no columns exist", () => {
    // `h` (moveLeft) has nothing to act on without columns.
    const event = makeKeyEvent({ key: "h" });
    dispatcher.handleKeydown(event);

    expect(focus.activePalette).toBeNull();
    expect(state.createColumnCalls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores keys with no key representation (modifier-only) when no columns exist", () => {
    const event = makeKeyEvent({ key: "Shift" });
    dispatcher.handleKeydown(event);

    expect(focus.activePalette).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores input field keypresses regardless of column state", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = makeKeyEvent({ key: "c", target: input });

    dispatcher.handleKeydown(event);

    expect(state.createColumnCalls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    input.remove();
  });

  it("Escape with active tag filter clears it before evaluating column whitelist", () => {
    data.activeTagFilter = "todo";
    const event = makeKeyEvent({ key: "Escape" });

    dispatcher.handleKeydown(event);

    expect(data.activeTagFilter).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("ActionDispatcher.selectDeckFromPalette", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-A"), makeDeck("deck-B")];

    data = new DeckData();
    await data.init();
    data.decks = [makeDeck("deck-A"), makeDeck("deck-B")];
    data.currentDeck = makeDeck("deck-A");
    data.columns = [];
    data.cardsByColumn = {};

    focus = new FocusManager(data);
    focus.openPalette("deck");
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("selects a different deck and closes the palette", () => {
    dispatcher.selectDeckFromPalette("deck-B");

    expect(focus.activePalette).toBeNull();
    expect(data.currentDeck?.id).toBe("deck-B");
  });

  it("does not call selectDeck when target deck equals current", () => {
    const spy = vi.spyOn(data, "selectDeck");

    dispatcher.selectDeckFromPalette("deck-A");

    expect(focus.activePalette).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not change anything when deckId is unknown", () => {
    const before = data.currentDeck?.id;
    const spy = vi.spyOn(data, "selectDeck");

    dispatcher.selectDeckFromPalette("does-not-exist");

    expect(spy).not.toHaveBeenCalled();
    expect(data.currentDeck?.id).toBe(before);
  });
});

describe("ActionDispatcher.executeAction palette routing", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [];
    data.cardsByColumn = {};
    focus = new FocusManager(data);
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("routes showCommandPalette to focus.openPalette('command')", async () => {
    await dispatcher.executeAction("showCommandPalette");
    expect(focus.activePalette).toBe("command");
  });

  it("routes showDeckPalette to focus.openPalette('deck')", async () => {
    await dispatcher.executeAction("showDeckPalette");
    expect(focus.activePalette).toBe("deck");
  });

  it("routes showColumnPalette to focus.openPalette('column')", async () => {
    await dispatcher.executeAction("showColumnPalette");
    expect(focus.activePalette).toBe("column");
  });

  it("routes openTagFilter to focus.openPalette('tag')", async () => {
    await dispatcher.executeAction("openTagFilter");
    expect(focus.activePalette).toBe("tag");
  });

  it("routes showTrashPalette to focus.openPalette('trash')", async () => {
    await dispatcher.executeAction("showTrashPalette");
    expect(focus.activePalette).toBe("trash");
  });

  it("routes showSettings to focus.showSettings = true (no palette)", async () => {
    await dispatcher.executeAction("showSettings");
    expect(focus.showSettings).toBe(true);
    expect(focus.activePalette).toBeNull();
    expect(focus.focusMode).not.toBe("command");
  });

  it("routes showAbout to focus.showAbout = true (no palette)", async () => {
    await dispatcher.executeAction("showAbout");
    expect(focus.showAbout).toBe(true);
    expect(focus.activePalette).toBeNull();
    expect(focus.focusMode).not.toBe("command");
  });

  it("routes showReporters to focus.showReporters = true (no palette)", async () => {
    await dispatcher.executeAction("showReporters");
    expect(focus.showReporters).toBe(true);
    expect(focus.activePalette).toBeNull();
    expect(focus.focusMode).not.toBe("command");
  });

  it("routes checkForUpdates to open the About dialog and trigger a check", async () => {
    const spy = vi.spyOn(updaterStore, "check");
    try {
      await dispatcher.executeAction("checkForUpdates");
      expect(focus.showAbout).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("Ctrl+, in card mode opens settings via the global keydown handler", () => {
    focus.focusMode = "card";
    const event = makeKeyEvent({ key: ",", ctrl: true });
    dispatcher.handleKeydown(event);

    expect(focus.showSettings).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("handleKeydown is a no-op while the settings dialog is open", () => {
    focus.showSettings = true;
    // Even a normally-bound key should not fire while settings owns input.
    const event = makeKeyEvent({ key: "c" });
    dispatcher.handleKeydown(event);

    expect(state.createColumnCalls).toEqual([]);
    expect(focus.activePalette).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("clearTagFilter clears the active filter on data", async () => {
    data.activeTagFilter = "todo";
    await dispatcher.executeAction("clearTagFilter");
    expect(data.activeTagFilter).toBeNull();
  });
});

describe("ActionDispatcher column-mode actions", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
      makeColumn("col-2", "deck-1", { position: 2 }),
    ];
    state.cardsByColumn = new Map([
      ["col-0", [makeCard("c-0-a", "col-0"), makeCard("c-0-b", "col-0")]],
      ["col-1", [makeCard("c-1-a", "col-1")]],
      ["col-2", []],
    ]);

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [...state.columns];
    data.cardsByColumn = Object.fromEntries(state.cardsByColumn);

    focus = new FocusManager(data);
    focus.focusMode = "column";
    focus.focusedColumnIndex = 1;

    dispatcher = new ActionDispatcher(data, focus);
  });

  it("moveLeft decrements focusedColumnIndex", async () => {
    await dispatcher.executeColumnAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("moveLeft is a no-op at the first column", async () => {
    focus.focusedColumnIndex = 0;
    await dispatcher.executeColumnAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("moveRight increments focusedColumnIndex", async () => {
    await dispatcher.executeColumnAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(2);
  });

  it("moveRight is a no-op at the last column", async () => {
    focus.focusedColumnIndex = 2;
    await dispatcher.executeColumnAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(2);
  });

  it("enterCardFocusFirst moves to first card and switches to card mode", async () => {
    await dispatcher.executeColumnAction("enterCardFocusFirst");
    expect(focus.focusMode).toBe("card");
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("enterCardFocusFirst is a no-op for an empty column", async () => {
    focus.focusedColumnIndex = 2; // col-2 has no cards
    await dispatcher.executeColumnAction("enterCardFocusFirst");
    expect(focus.focusMode).toBe("column");
  });

  it("enterCardFocusLast moves to last card and switches to card mode", async () => {
    focus.focusedColumnIndex = 0; // col-0 has 2 cards
    await dispatcher.executeColumnAction("enterCardFocusLast");
    expect(focus.focusMode).toBe("card");
    expect(focus.focusedCardIndex).toBe(1);
  });

  it("createCard delegates to data.createCard for the focused column", async () => {
    await dispatcher.executeColumnAction("createCard");
    expect(state.createCardCalls.length).toBe(1);
    expect(state.createCardCalls[0].column_id).toBe("col-1");
    expect(focus.editingCardId).not.toBeNull();
  });

  it("deleteColumn calls db.deleteColumn for the focused column", async () => {
    await dispatcher.executeColumnAction("deleteColumn");
    expect(state.deleteColumnCalls).toContain("col-1");
  });

  it("reorderColumnLeft moves the column when not at the start", async () => {
    await dispatcher.executeColumnAction("reorderColumnLeft");
    expect(state.moveColumnCalls.length).toBe(1);
    expect(state.moveColumnCalls[0].id).toBe("col-1");
  });

  it("reorderColumnLeft is a no-op at the first column", async () => {
    focus.focusedColumnIndex = 0;
    await dispatcher.executeColumnAction("reorderColumnLeft");
    expect(state.moveColumnCalls.length).toBe(0);
  });

  it("reorderColumnRight moves the column when not at the end", async () => {
    await dispatcher.executeColumnAction("reorderColumnRight");
    expect(state.moveColumnCalls.length).toBe(1);
  });

  it("createColumn delegates to data.createColumnAtPosition", async () => {
    await dispatcher.executeColumnAction("createColumn");
    expect(state.createColumnCalls.length).toBe(1);
  });
});

describe("ActionDispatcher card-mode actions", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
    ];
    state.cardsByColumn = new Map([
      [
        "col-0",
        [
          makeCard("c-0-a", "col-0"),
          makeCard("c-0-b", "col-0"),
          makeCard("c-0-c", "col-0"),
        ],
      ],
      ["col-1", [makeCard("c-1-a", "col-1")]],
    ]);

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [...state.columns];
    data.cardsByColumn = Object.fromEntries(state.cardsByColumn);

    focus = new FocusManager(data);
    focus.focusMode = "card";
    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 1;

    dispatcher = new ActionDispatcher(data, focus);
  });

  it("moveDown advances focusedCardIndex within the column", async () => {
    await dispatcher.executeCardAction("moveDown");
    expect(focus.focusedCardIndex).toBe(2);
  });

  it("moveDown is a no-op at the last card", async () => {
    focus.focusedCardIndex = 2;
    await dispatcher.executeCardAction("moveDown");
    expect(focus.focusedCardIndex).toBe(2);
  });

  it("moveUp decrements focusedCardIndex", async () => {
    await dispatcher.executeCardAction("moveUp");
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("moveUp is a no-op at the first card", async () => {
    focus.focusedCardIndex = 0;
    await dispatcher.executeCardAction("moveUp");
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("moveLeft is a no-op at the first column in card mode", async () => {
    await dispatcher.executeCardAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("moveRight switches columns and saves/restores card index", async () => {
    await dispatcher.executeCardAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(1);
    // col-1 has 1 card → restoreCardIndex falls back to length-1 = 0
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("goFirst snaps focusedCardIndex to 0", async () => {
    await dispatcher.executeCardAction("goFirst");
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("goLast snaps focusedCardIndex to last card", async () => {
    await dispatcher.executeCardAction("goLast");
    expect(focus.focusedCardIndex).toBe(2);
  });

  it("scrollHalfPageUp clamps to 0", async () => {
    await dispatcher.executeCardAction("scrollHalfPageUp");
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("scrollHalfPageDown clamps to last card", async () => {
    await dispatcher.executeCardAction("scrollHalfPageDown");
    expect(focus.focusedCardIndex).toBe(2);
  });

  it("exitToColumn switches to column mode", async () => {
    await dispatcher.executeCardAction("exitToColumn");
    expect(focus.focusMode).toBe("column");
  });

  it("startEdit transitions into edit mode for the focused card", async () => {
    await dispatcher.executeCardAction("startEdit");
    expect(focus.focusMode).toBe("edit");
    expect(focus.editingCardId).toBe("c-0-b");
  });

  it("deleteCard calls db.deleteCard for the focused card", async () => {
    await dispatcher.executeCardAction("deleteCard");
    expect(state.deleteCardCalls).toContain("c-0-b");
  });

  it("scoreUp invokes db.updateCardScore with +1", async () => {
    await dispatcher.executeCardAction("scoreUp");
    expect(state.updateCardScoreCalls[0]).toEqual({ id: "c-0-b", delta: 1 });
  });

  it("scoreDown invokes db.updateCardScore with -1", async () => {
    await dispatcher.executeCardAction("scoreDown");
    expect(state.updateCardScoreCalls[0]).toEqual({ id: "c-0-b", delta: -1 });
  });

  it("copyCard puts a snapshot of the focused card on the clipboard", async () => {
    await dispatcher.executeCardAction("copyCard");
    expect(focus.clipboardCard?.id).toBe("c-0-b");
  });

  it("pasteBelow creates a card after the focused card from clipboard", async () => {
    focus.clipboardCard = { ...makeCard("clip", "col-0"), content: "pasted" };
    await dispatcher.executeCardAction("pasteBelow");
    expect(state.createCardCalls[0]?.content).toBe("pasted");
  });

  it("reorderCardDown calls db.moveCard with index+1", async () => {
    await dispatcher.executeCardAction("reorderCardDown");
    expect(state.moveCardCalls[0]).toEqual({ id: "c-0-b", position: 2 });
  });

  it("reorderCardUp calls db.moveCard with index-1", async () => {
    await dispatcher.executeCardAction("reorderCardUp");
    expect(state.moveCardCalls[0]).toEqual({ id: "c-0-b", position: 0 });
  });

  it("createCardBelow inserts at focusedCardIndex+1 and starts editing it", async () => {
    await dispatcher.executeCardAction("createCardBelow");
    expect(state.createCardCalls[0]?.position).toBe(2);
    expect(focus.focusMode).toBe("edit");
  });

  it("createCardAbove inserts at focusedCardIndex and starts editing it", async () => {
    await dispatcher.executeCardAction("createCardAbove");
    expect(state.createCardCalls[0]?.position).toBe(1);
    expect(focus.focusMode).toBe("edit");
  });
});

describe("ActionDispatcher.executeCommand", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [];
    data.cardsByColumn = {};
    focus = new FocusManager(data);
    focus.openPalette("command");
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("closes the palette before running the command", async () => {
    expect(focus.activePalette).toBe("command");
    await dispatcher.executeCommand("showShortcuts");
    expect(focus.activePalette).toBeNull();
    expect(focus.showCheatsheet).toBe(true);
  });

  it("newDeck delegates to data.createDeck", async () => {
    await dispatcher.executeCommand("newDeck");
    expect(state.createDeckCalls).toBe(1);
  });

  it("restoreOnboarding rebuilds the Getting Started deck and closes the palette", async () => {
    await dispatcher.executeCommand("restoreOnboarding");
    await flushPromises();
    expect(state.createDeckCalls).toBe(1);
    expect(focus.activePalette).toBeNull();
  });

  it("switchDeck reopens the deck palette", async () => {
    await dispatcher.executeCommand("switchDeck");
    expect(focus.activePalette).toBe("deck");
  });

  it("renameDeck triggers the onRenameDeck callback", () => {
    const calls: number[] = [];
    dispatcher.onRenameDeck = () => calls.push(1);
    dispatcher.executeCommand("renameDeck");
    expect(calls).toEqual([1]);
  });

  it("deleteDeck triggers the onDeleteDeck callback", () => {
    const calls: number[] = [];
    dispatcher.onDeleteDeck = () => calls.push(1);
    dispatcher.executeCommand("deleteDeck");
    expect(calls).toEqual([1]);
  });

  it("renameColumn triggers the onRenameColumn callback", () => {
    const calls: number[] = [];
    dispatcher.onRenameColumn = () => calls.push(1);
    dispatcher.executeCommand("renameColumn");
    expect(calls).toEqual([1]);
  });

  it("deleteColumn triggers the onDeleteColumn callback", () => {
    const calls: number[] = [];
    dispatcher.onDeleteColumn = () => calls.push(1);
    dispatcher.executeCommand("deleteColumn");
    expect(calls).toEqual([1]);
  });

  it("newColumn delegates to data.createColumn", async () => {
    await dispatcher.executeCommand("newColumn");
    expect(state.createColumnCalls.length).toBe(1);
  });

  it("default branch forwards unknown actions through executeAction", async () => {
    await dispatcher.executeCommand("openTagFilter");
    expect(focus.activePalette).toBe("tag");
  });
});

describe("ActionDispatcher jumpToColumn (via executeAction)", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
      makeColumn("col-2", "deck-1", { position: 2 }),
    ];
    state.cardsByColumn = new Map([
      ["col-0", [makeCard("c-0-a", "col-0")]],
      ["col-1", [makeCard("c-1-a", "col-1")]],
      ["col-2", []],
    ]);

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [...state.columns];
    data.cardsByColumn = Object.fromEntries(state.cardsByColumn);

    focus = new FocusManager(data);
    focus.focusMode = "column";
    focus.focusedColumnIndex = 0;
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("ignores jumps to out-of-range indices", async () => {
    await dispatcher.executeAction("jumpToColumn:9");
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("ignores jumps to the already-focused column", async () => {
    const before = focus.focusedColumnIndex;
    await dispatcher.executeAction("jumpToColumn:0");
    expect(focus.focusedColumnIndex).toBe(before);
  });

  it("jumps to a target column in column mode", async () => {
    await dispatcher.executeAction("jumpToColumn:2");
    expect(focus.focusedColumnIndex).toBe(2);
  });

  it("jumps to a target column in card mode and falls back to column mode for empty columns", async () => {
    focus.focusMode = "card";
    focus.focusedCardIndex = 0;
    await dispatcher.executeAction("jumpToColumn:2"); // col-2 is empty
    expect(focus.focusedColumnIndex).toBe(2);
    expect(focus.focusMode).toBe("column");
  });

  it("ignores jumps with no parameter", async () => {
    const before = focus.focusedColumnIndex;
    await dispatcher.executeAction("jumpToColumn");
    expect(focus.focusedColumnIndex).toBe(before);
  });
});

describe("ActionDispatcher.selectColumnFromPalette", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
    ];
    state.cardsByColumn = new Map([
      ["col-0", [makeCard("c-0-a", "col-0")]],
      ["col-1", []],
    ]);

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [...state.columns];
    data.cardsByColumn = Object.fromEntries(state.cardsByColumn);

    focus = new FocusManager(data);
    focus.focusMode = "card";
    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 0;
    focus.openPalette("column");
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("switches to the selected column and downgrades to column mode if empty", () => {
    dispatcher.selectColumnFromPalette(1);
    expect(focus.activePalette).toBeNull();
    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.focusMode).toBe("column"); // col-1 has no cards
  });

  it("is a no-op when the same column is selected", () => {
    dispatcher.selectColumnFromPalette(0);
    expect(focus.focusedColumnIndex).toBe(0);
  });
});

describe("ActionDispatcher destroy", () => {
  beforeEach(() => {
    resetState();
    state.decks = [makeDeck("deck-1")];
  });

  it("destroy resets the key processor and does not throw", async () => {
    const data = new DeckData();
    await data.init();
    const focus = new FocusManager(data);
    const dispatcher = new ActionDispatcher(data, focus);

    expect(() => dispatcher.destroy()).not.toThrow();
  });
});

describe("ActionDispatcher.handleKeydown routing", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
    ];
    state.cardsByColumn = new Map([
      ["col-0", [makeCard("c-0-a", "col-0")]],
      ["col-1", [makeCard("c-1-a", "col-1")]],
    ]);

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [...state.columns];
    data.cardsByColumn = Object.fromEntries(state.cardsByColumn);

    focus = new FocusManager(data);
    focus.focusMode = "column";
    focus.focusedColumnIndex = 0;
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("does nothing while in edit mode", () => {
    focus.focusMode = "edit";
    const event = makeKeyEvent({ key: "j" });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(focus.focusMode).toBe("edit");
  });

  it("processes a palette trigger while a palette is open (command mode)", () => {
    focus.openPalette("deck"); // focusMode -> command
    const event = makeKeyEvent({ key: "P", ctrl: true, shift: true });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores non-trigger keys while a palette is open", () => {
    focus.openPalette("deck");
    const event = makeKeyEvent({ key: "j" });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores modifier-only keys while a palette is open", () => {
    focus.openPalette("deck");
    const event = makeKeyEvent({ key: "Shift" });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("closes the cheatsheet on Escape", () => {
    focus.showCheatsheet = true;
    const event = makeKeyEvent({ key: "Escape" });
    dispatcher.handleKeydown(event);
    expect(focus.showCheatsheet).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores unrelated keys while the cheatsheet is open", () => {
    focus.showCheatsheet = true;
    const event = makeKeyEvent({ key: "a" });
    dispatcher.handleKeydown(event);
    expect(focus.showCheatsheet).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("opens the cheatsheet with ?", () => {
    const event = makeKeyEvent({ key: "?" });
    dispatcher.handleKeydown(event);
    expect(focus.showCheatsheet).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("opens the cheatsheet with Ctrl+/", () => {
    const event = makeKeyEvent({ key: "/", ctrl: true });
    dispatcher.handleKeydown(event);
    expect(focus.showCheatsheet).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("is a no-op while the keybindings dialog is open", () => {
    focus.showKeybindings = true;
    const event = makeKeyEvent({ key: "j" });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("is a no-op while the about dialog is open", () => {
    focus.showAbout = true;
    const event = makeKeyEvent({ key: "j" });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(focus.focusMode).toBe("column");
  });

  it("is a no-op while the reporters dialog is open", () => {
    focus.showReporters = true;
    const event = makeKeyEvent({ key: "j" });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(focus.focusMode).toBe("column");
  });

  it("dispatches a bound action through the key processor", () => {
    const event = makeKeyEvent({ key: "j" }); // column mode: enterCardFocusFirst
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(true);
    expect(focus.focusMode).toBe("card");
  });

  it("swallows a valid multi-key prefix without acting", () => {
    const event = makeKeyEvent({ key: "d" }); // prefix for "dd"
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(true);
    expect(focus.focusMode).toBe("column");
  });

  it("ignores keys with no representation on the main path", () => {
    const event = makeKeyEvent({ key: "Shift" });
    dispatcher.handleKeydown(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("ActionDispatcher card-mode cross-column and paste actions", () => {
  let data: InstanceType<typeof DeckData>;
  let focus: InstanceType<typeof FocusManager>;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
    ];
    state.cardsByColumn = new Map([
      ["col-0", [makeCard("c-0-a", "col-0"), makeCard("c-0-b", "col-0")]],
      ["col-1", [makeCard("c-1-a", "col-1")]],
    ]);

    data = new DeckData();
    await data.init();
    data.currentDeck = makeDeck("deck-1");
    data.columns = [...state.columns];
    data.cardsByColumn = Object.fromEntries(state.cardsByColumn);

    focus = new FocusManager(data);
    focus.focusMode = "card";
    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 0;
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("moveCardLeft moves the focused card to the previous column", async () => {
    focus.focusedColumnIndex = 1;
    focus.focusedCardIndex = 0;
    await dispatcher.executeCardAction("moveCardLeft");
    expect(state.moveCardToColumnCalls[0]).toEqual({
      id: "c-1-a",
      column_id: "col-0",
    });
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("moveCardLeft is a no-op at the first column", async () => {
    focus.focusedColumnIndex = 0;
    await dispatcher.executeCardAction("moveCardLeft");
    expect(state.moveCardToColumnCalls.length).toBe(0);
  });

  it("moveCardRight moves the focused card to the next column", async () => {
    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 0;
    await dispatcher.executeCardAction("moveCardRight");
    expect(state.moveCardToColumnCalls[0].column_id).toBe("col-1");
    expect(focus.focusedColumnIndex).toBe(1);
  });

  it("moveCardRight is a no-op at the last column", async () => {
    focus.focusedColumnIndex = 1;
    await dispatcher.executeCardAction("moveCardRight");
    expect(state.moveCardToColumnCalls.length).toBe(0);
  });

  it("moveLeft navigates to the previous column and stays in card mode", async () => {
    focus.focusedColumnIndex = 1;
    focus.focusedCardIndex = 0;
    await dispatcher.executeCardAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.focusMode).toBe("card"); // col-0 has cards
  });

  it("moveRight to an empty column drops to column mode", async () => {
    data.cardsByColumn = { ...data.cardsByColumn, "col-1": [] };
    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 0;
    await dispatcher.executeCardAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.focusMode).toBe("column");
  });

  it("pasteAbove creates a card at the focused index from the clipboard", async () => {
    focus.focusedCardIndex = 1;
    focus.clipboardCard = { ...makeCard("clip", "col-0"), content: "above" };
    await dispatcher.executeCardAction("pasteAbove");
    expect(state.createCardCalls[0]?.content).toBe("above");
    expect(state.createCardCalls[0]?.position).toBe(1);
  });

  it("pasteBelow/pasteAbove are no-ops with an empty clipboard", async () => {
    focus.clipboardCard = null;
    await dispatcher.executeCardAction("pasteAbove");
    await dispatcher.executeCardAction("pasteBelow");
    expect(state.createCardCalls.length).toBe(0);
  });

  it("deleteCard exits to column mode when the column becomes empty", async () => {
    focus.focusedColumnIndex = 1; // col-1 has a single card
    focus.focusedCardIndex = 0;
    await dispatcher.executeCardAction("deleteCard");
    expect(state.deleteCardCalls).toContain("c-1-a");
    expect(focus.focusMode).toBe("column");
  });
});
