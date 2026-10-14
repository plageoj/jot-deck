import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DeckData } from "#lib/deckData.svelte.ts";
import type { FocusManager } from "#lib/focusManager.svelte.ts";
import { makeCard, makeColumn, makeDeck } from "./__fixtures__/models";
import { boardState } from "./__fixtures__/boardBackend";
import { setupBoard } from "./__fixtures__/boardHarness";
import { updaterStore } from "./updater.svelte";

// ActionDispatcher owns key interpretation, mode-dependent routing, palette
// command dispatch, and the public dispatch entry points. The semantic
// operations it routes to are covered by:
// - boardActionExecutors.{navigation,cards,columns}.test.ts
// - actionDispatchHelpers.test.ts (global actions)
// The integration tests here verify the wiring through the public entry points.

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/boardBackend");
  return { getDatabase: async () => mockBackend };
});

const { ActionDispatcher } = await import("./actionDispatcher.svelte");

async function flushPromises() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
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

/** Three columns (col-2 empty), as used by most routing tests. */
function threeColumnBoard() {
  return setupBoard({
    columns: [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
      makeColumn("col-2", "deck-1", { position: 2 }),
    ],
    cards: {
      "col-0": [makeCard("c-0-a", "col-0"), makeCard("c-0-b", "col-0")],
      "col-1": [makeCard("c-1-a", "col-1")],
      "col-2": [],
    },
  });
}

describe("ActionDispatcher with no columns loaded", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard());
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

    expect(boardState.createColumnCalls).toHaveLength(1);
    expect(boardState.createColumnCalls[0]).toEqual({ deck_id: "deck-1", position: 0 });
    expect(event.defaultPrevented).toBe(true);
  });

  it("pops the undo stack via `u` when no columns exist", async () => {
    const undo = vi.fn(async () => {});
    data.history.push({ undo, redo: async () => {} });

    const event = makeKeyEvent({ key: "u" });
    dispatcher.handleKeydown(event);

    await flushPromises();

    expect(undo).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("pops the redo stack via `Ctrl+r` when no columns exist", async () => {
    const redo = vi.fn(async () => {});
    data.history.push({ undo: async () => {}, redo });
    await data.history.undo();

    const event = makeKeyEvent({ key: "r", ctrl: true });
    dispatcher.handleKeydown(event);

    await flushPromises();

    expect(redo).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores non-whitelisted column keys when no columns exist", () => {
    // `h` (moveLeft) has nothing to act on without columns.
    const event = makeKeyEvent({ key: "h" });
    dispatcher.handleKeydown(event);

    expect(focus.activePalette).toBeNull();
    expect(boardState.createColumnCalls).toEqual([]);
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

    expect(boardState.createColumnCalls).toEqual([]);
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
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard({
      decks: [makeDeck("deck-A"), makeDeck("deck-B")],
    }));
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

  it("reports deck selection failures through the data error state", async () => {
    vi.spyOn(data, "selectDeck").mockRejectedValue(new Error("deck load failed"));

    dispatcher.selectDeckFromPalette("deck-B");

    await vi.waitFor(() => {
      expect(data.error).toBe("Failed to execute action: Error: deck load failed");
    });
  });

  it("does not change anything when deckId is unknown", () => {
    const before = data.currentDeck?.id;
    const spy = vi.spyOn(data, "selectDeck");

    dispatcher.selectDeckFromPalette("does-not-exist");

    expect(spy).not.toHaveBeenCalled();
    expect(data.currentDeck?.id).toBe(before);
  });
});

describe("ActionDispatcher.executeAction global routing", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard());
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("routes global actions before focus-mode routing", async () => {
    focus.focusMode = "card";
    await dispatcher.executeAction("showTrashPalette");
    expect(focus.activePalette).toBe("trash");
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

    expect(boardState.createColumnCalls).toEqual([]);
    expect(focus.activePalette).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("ActionDispatcher board operation routing", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await threeColumnBoard());
    focus.focusMode = "column";
    focus.focusedColumnIndex = 1;
    dispatcher = new ActionDispatcher(data, focus);
  });

  it("routes actions to column operations in column focus", async () => {
    await dispatcher.executeAction("deleteCard");
    await dispatcher.executeAction("deleteColumn");

    expect(boardState.deleteCardCalls).toEqual([]);
    expect(boardState.deleteColumnCalls).toEqual(["col-1"]);
  });

  it("routes actions to card operations in card focus", async () => {
    focus.focusMode = "card";
    focus.focusedCardIndex = 0;

    await dispatcher.executeAction("deleteColumn");
    await dispatcher.executeAction("deleteCard");

    expect(boardState.deleteColumnCalls).toEqual([]);
    expect(boardState.deleteCardCalls).toEqual(["c-1-a"]);
  });

  it("uses UI callbacks assigned after construction", async () => {
    const startEdit = vi.fn();
    const renameColumn = vi.fn();
    dispatcher.onStartEdit = startEdit;
    dispatcher.onRenameColumn = renameColumn;

    await dispatcher.executeAction("createCard");
    focus.focusMode = "column";
    await dispatcher.executeAction("renameColumn");

    expect(startEdit).toHaveBeenCalledWith("created-card-1");
    expect(renameColumn).toHaveBeenCalledOnce();
  });

  it("reports a failed edit-start callback through the data error state", async () => {
    focus.focusMode = "card";
    focus.focusedCardIndex = 0;
    dispatcher.onStartEdit = () => Promise.reject(new Error("lock held"));

    await dispatcher.executeAction("startEdit");

    await vi.waitFor(() => {
      expect(data.error).toBe("Failed to execute action: Error: lock held");
    });
  });

  it("undo clamps a focus index left past the last column", async () => {
    // Undoing a column create shrinks the list under the focused index; the
    // next createColumn must not insert past the end (issue #81).
    focus.focusedColumnIndex = 2;
    data.history.push({
      undo: async () => {
        data.columns = data.columns.slice(0, 2);
      },
      redo: async () => {},
    });

    await dispatcher.executeAction("undo");
    expect(focus.focusedColumnIndex).toBe(1);

    await dispatcher.executeColumnAction("createColumn");
    expect(boardState.createColumnCalls[0].position).toBe(2);
  });
});

describe("ActionDispatcher.executeCommand", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard());
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
    expect(boardState.createDeckCalls).toBe(1);
  });

  it("restoreOnboarding rebuilds the Getting Started deck and closes the palette", async () => {
    await dispatcher.executeCommand("restoreOnboarding");
    await flushPromises();
    expect(boardState.createDeckCalls).toBe(1);
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

  it("newColumn inserts to the right of the focused column and focuses it", async () => {
    boardState.columns = [makeColumn("col-0", "deck-1", { position: 0 })];
    data.columns = [...boardState.columns];
    focus.focusedColumnIndex = 0;
    focus.previousFocusMode = "card";
    const scrolledIndices: number[] = [];
    focus.onScrollToColumn = (index) => scrolledIndices.push(index);
    await dispatcher.executeCommand("newColumn");
    await vi.waitFor(() => {
      expect(data.columns[focus.focusedColumnIndex]?.id).toBe("created-1");
    });
    expect(boardState.createColumnCalls).toEqual([{ deck_id: "deck-1", position: 1 }]);
    expect(focus.focusMode).toBe("column");
    expect(scrolledIndices).toEqual([1]);
  });

  it("default branch forwards unknown actions through executeAction", async () => {
    await dispatcher.executeCommand("openTagFilter");
    expect(focus.activePalette).toBe("tag");
  });
});

describe("ActionDispatcher jumpToColumn (via executeAction)", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await threeColumnBoard());
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
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard({
      columns: [
        makeColumn("col-0", "deck-1", { position: 0 }),
        makeColumn("col-1", "deck-1", { position: 1 }),
      ],
      cards: {
        "col-0": [makeCard("c-0-a", "col-0")],
        "col-1": [],
      },
    }));
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
  it("destroy resets the key processor and does not throw", async () => {
    const { data, focus } = await setupBoard();
    const dispatcher = new ActionDispatcher(data, focus);

    expect(() => dispatcher.destroy()).not.toThrow();
  });
});

describe("ActionDispatcher.handleKeydown routing", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard({
      columns: [
        makeColumn("col-0", "deck-1", { position: 0 }),
        makeColumn("col-1", "deck-1", { position: 1 }),
      ],
      cards: {
        "col-0": [makeCard("c-0-a", "col-0")],
        "col-1": [makeCard("c-1-a", "col-1")],
      },
    }));
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

describe("ActionDispatcher while the selected deck is not loaded", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard({
      decks: [makeDeck("deck-1"), makeDeck("deck-2")],
      columns: [makeColumn("col-0", "deck-1")],
      cards: { "col-0": [] },
    }));
    // Simulate a failed switch to deck-2: selected, but nothing committed.
    data.currentDeck = data.decks[1];
    data.loadedDeckId = null;
    data.columns = [];
    data.cardsByColumn = {};
    data.deckLoadError = "Failed to load deck: Error: db gone";

    focus.focusMode = "column";
    dispatcher = new ActionDispatcher(data, focus);
  });

  it.each(["Enter", "r"])("%s on the failure view retries the load", async (key) => {
    const reload = vi.spyOn(data, "reloadDeck").mockResolvedValue(true);
    const event = makeKeyEvent({ key });

    dispatcher.handleKeydown(event);

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("Ctrl+r is not a retry (it stays redo, which is blocked)", async () => {
    const reload = vi.spyOn(data, "reloadDeck");
    const redo = vi.spyOn(data.history, "redo");

    dispatcher.handleKeydown(makeKeyEvent({ key: "r", ctrl: true }));
    await flushPromises();

    expect(reload).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("does not retry with Enter while a switch is merely in progress", async () => {
    data.deckLoadError = null;
    const reload = vi.spyOn(data, "reloadDeck");

    dispatcher.handleKeydown(makeKeyEvent({ key: "Enter" }));
    await flushPromises();

    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores board mutations such as creating a column or undo", async () => {
    const undo = vi.spyOn(data.history, "undo");

    dispatcher.handleKeydown(makeKeyEvent({ key: "c" }));
    dispatcher.handleKeydown(makeKeyEvent({ key: "u" }));
    await dispatcher.executeAction("createColumn");
    dispatcher.executeCommand("newColumn");
    await flushPromises();

    expect(boardState.createColumnCalls).toHaveLength(0);
    expect(undo).not.toHaveBeenCalled();
  });

  it("does not invoke column rename/delete callbacks from the palette", () => {
    const rename = vi.fn();
    const remove = vi.fn();
    dispatcher.onRenameColumn = rename;
    dispatcher.onDeleteColumn = remove;

    dispatcher.executeCommand("renameColumn");
    dispatcher.executeCommand("deleteColumn");

    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("still opens the deck palette", () => {
    dispatcher.handleKeydown(makeKeyEvent({ key: "p", ctrl: true }));
    expect(focus.activePalette).toBe("deck");
  });

  it("re-selecting the current deck from the palette retries it", () => {
    const select = vi.spyOn(data, "selectDeck").mockResolvedValue(true);

    dispatcher.selectDeckFromPalette("deck-2");

    expect(select).toHaveBeenCalledWith(data.decks[1]);
  });

  it("the Reload Deck command reloads and clamps focus on success", async () => {
    vi.spyOn(data, "reloadDeck").mockResolvedValue(true);
    const clamp = vi.spyOn(focus, "clampToLoadedDeck");

    dispatcher.executeCommand("reloadDeck");

    await vi.waitFor(() => expect(clamp).toHaveBeenCalled());
  });
});
