import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { Card, Column, ReporterConfig } from "#lib/types.ts";
import { makeCard, makeColumn, makeDeck } from "./__fixtures__/models";
import {
  deckState as state,
  mockBackend,
  resetDeckState as resetState,
  seedSingleDeck,
} from "./__fixtures__/deckDataBackend";

// DeckData owns the DB-backed deck state: deck lifecycle, CRUD with undo
// history, edit sessions, refresh, tags, and Reporter registry forwarding.
// Focused suites cover the rest:
// - deckLoad.test.ts: guarded snapshot load/commit ordering
// - deckData.trash.test.ts: trash listing and restore
// - cardEditSessions.test.ts: edit lock acquisition, saves, and lease renewal
// - externalChangeEvents.test.ts / reporterStream.test.ts: event subscription
//   and stream overlay lifecycles (only their DeckData wiring is tested here)

// Toggle the simulated Tauri environment per test (name prefixed `mock` so the
// hoisted vi.mock factory may reference it).
const mockEnv = { tauri: false };
const mockListen = vi.fn(async (_event: string, _handler: () => void) => () => {});

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/deckDataBackend");
  return { getDatabase: async () => mockBackend, isTauri: () => mockEnv.tauri };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

const { DeckData, ACTIVE_DECK_SETTING_KEY } = await import("./deckData.svelte");
const { FOCUS_STATE_PREFIX } = await import("./focusManager.svelte");
const focusKey = (deckId: string) => FOCUS_STATE_PREFIX + deckId;

describe("DeckData deck lifecycle", () => {
  beforeEach(() => {
    resetState();
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

  it("creates a Getting Started deck with seed columns and cards when no decks exist", async () => {
    const fresh = new DeckData();
    await fresh.init();

    expect(fresh.decks).toHaveLength(1);
    expect(fresh.decks[0].name).toBe("Getting Started");
  });

  it("restoreOnboardingDeck prepends and selects a fresh deck without removing existing decks", async () => {
    state.decks = [makeDeck("existing-deck", "My Notes")];

    const fresh = new DeckData();
    await fresh.init();
    expect(fresh.decks).toHaveLength(1);

    const restored = await fresh.restoreOnboardingDeck();

    expect(restored).not.toBeNull();
    expect(restored?.name).toBe("Getting Started");
    // Prepended, existing deck preserved.
    expect(fresh.decks).toHaveLength(2);
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

  it("publishes the selected deck to the shared settings for the MCP bridge", async () => {
    state.decks = [makeDeck("first"), makeDeck("second")];

    const fresh = new DeckData();
    await fresh.init();
    await fresh.selectDeck(makeDeck("second"));

    expect(state.settingsWrites).toEqual([
      [ACTIVE_DECK_SETTING_KEY, JSON.stringify("first")],
      [ACTIVE_DECK_SETTING_KEY, JSON.stringify("second")],
    ]);
  });

  it("serializes active-deck writes so the last switch wins, even past a failure", async () => {
    state.decks = [makeDeck("a"), makeDeck("b"), makeDeck("c")];
    const fresh = new DeckData();
    await fresh.init();
    await vi.waitFor(() => expect(state.settingsWrites).toHaveLength(1));

    // Hold the next write open, fail the one after, and let the last succeed.
    let releaseSlow!: () => void;
    const landed: string[] = [];
    const spy = vi
      .spyOn(mockBackend, "setSettings")
      .mockImplementationOnce(
        (_key, value) =>
          new Promise<void>((r) => {
            releaseSlow = () => {
              landed.push(value);
              r();
            };
          }),
      )
      .mockImplementationOnce(() => Promise.reject(new Error("locked")))
      .mockImplementationOnce(async (_key, value) => {
        landed.push(value);
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    void fresh.selectDeck(makeDeck("a"));
    void fresh.selectDeck(makeDeck("b"));
    void fresh.selectDeck(makeDeck("c"));
    await Promise.resolve();
    // Later writes wait behind the open one instead of racing it.
    expect(spy).toHaveBeenCalledTimes(1);

    releaseSlow();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(landed).toHaveLength(2));
    expect(landed).toEqual([JSON.stringify("a"), JSON.stringify("c")]);
    expect(warn).toHaveBeenCalledOnce();

    spy.mockRestore();
    warn.mockRestore();
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

    await data.history.undo();
    expect(data.columns.find((c) => c.id === "col-active")?.name).toBe(
      "col-active-name",
    );
    await data.history.redo();
    expect(data.columns.find((c) => c.id === "col-active")?.name).toBe(
      "Renamed Col",
    );
  });

  it("createColumn appends a new column with empty cards array", async () => {
    const before = data.columns.length;
    const col = await data.createColumn();
    expect(col).not.toBeNull();
    expect(data.columns).toHaveLength(before + 1);
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

  it("createColumnAtPosition still records the created column when the refresh fails", async () => {
    vi.spyOn(mockBackend, "getColumnsByDeck").mockRejectedValueOnce(
      new Error("reload failed"),
    );
    const columnsBefore = data.columns;

    const col = await data.createColumnAtPosition(0);

    // The board is kept as loaded; the next successful load shows the column.
    expect(col).not.toBeNull();
    expect(data.columns).toBe(columnsBefore);
    expect(data.error).toContain("Failed to reload deck");
    await data.history.undo();
    expect(state.deleteColumnCalls).toContain(col!.id);
  });

  it("createColumnAtPosition does not update a deck selected during reload", async () => {
    const createdColumn = makeColumn("created-in-deck-1", "deck-1", { position: 1 });
    const otherDeck = makeDeck("deck-2");
    const otherColumn = makeColumn("col-deck-2", "deck-2");
    let rejectReload: (error: Error) => void;
    let signalReloadStarted!: () => void;
    const reloadStarted = new Promise<void>((resolve) => {
      signalReloadStarted = resolve;
    });

    vi.spyOn(mockBackend, "createColumn").mockResolvedValueOnce(createdColumn);
    vi.spyOn(mockBackend, "getColumnsByDeck").mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectReload = reject;
          signalReloadStarted();
        }),
    );

    const creating = data.createColumnAtPosition(1);
    await reloadStarted;
    data.currentDeck = otherDeck;
    data.columns = [otherColumn];
    data.cardsByColumn = { [otherColumn.id]: [] };
    data.history.clear();
    rejectReload!(new Error("reload failed"));

    await expect(creating).resolves.toEqual(createdColumn);
    expect(data.columns).toEqual([otherColumn]);
    expect(data.cardsByColumn).toEqual({ [otherColumn.id]: [] });
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
    await data.refreshDeck();

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

  it("createCard undo deletes the new card, redo restores it", async () => {
    const card = await data.createCard("col-active", "hello");
    expect(card).not.toBeNull();

    await data.history.undo();
    expect(state.deleteCardCalls).toEqual([card!.id]);

    await data.history.redo();
    expect(state.restoreCardCalls).toEqual([card!.id]);
  });

  it("deleteCard undo restores it, redo deletes it again", async () => {
    const ok = await data.deleteCard("card-1");
    expect(ok).toBe(true);

    await data.history.undo();
    expect(state.restoreCardCalls).toEqual(["card-1"]);

    await data.history.redo();
    expect(state.deleteCardCalls).toEqual(["card-1", "card-1"]);
  });

  it("createColumn undo deletes the new column, redo restores it", async () => {
    const col = await data.createColumn();
    expect(col).not.toBeNull();

    await data.history.undo();
    expect(state.deleteColumnCalls).toEqual([col!.id]);

    await data.history.redo();
    expect(state.restoreColumnCalls).toEqual([col!.id]);
  });

  it("deleteColumn undo restores it, redo deletes it again", async () => {
    const ok = await data.deleteColumn("col-active");
    expect(ok).toBe(true);

    await data.history.undo();
    expect(state.restoreColumnCalls).toEqual(["col-active"]);

    await data.history.redo();
    expect(state.deleteColumnCalls).toEqual(["col-active", "col-active"]);
  });

  it("saveCard undo restores the previous content, redo re-applies the new content", async () => {
    state.cardsByColumn = new Map([
      ["col-active", [makeCard("card-1", "col-active", { content: "old" })]],
    ]);
    await data.refreshDeck();

    await data.saveCard("card-1", "new content");
    expect(data.cardsByColumn["col-active"][0].content).toBe("new content");

    await data.history.undo();
    expect(data.cardsByColumn["col-active"][0].content).toBe("old");

    await data.history.redo();
    expect(data.cardsByColumn["col-active"][0].content).toBe("new content");
  });

  it("moveCard undo/redo restores the original position", async () => {
    state.cardsByColumn = new Map([
      [
        "col-active",
        [makeCard("card-a", "col-active"), makeCard("card-b", "col-active")],
      ],
    ]);
    await data.refreshDeck();

    await data.moveCard("card-a", 1);
    expect(state.moveCardCalls).toEqual([{ id: "card-a", position: 1 }]);

    await data.history.undo();
    expect(state.moveCardCalls.at(-1)).toEqual({ id: "card-a", position: 0 });

    await data.history.redo();
    expect(state.moveCardCalls.at(-1)).toEqual({ id: "card-a", position: 1 });
  });

  it("moveColumn undo/redo restores the original position", async () => {
    state.columns = [
      makeColumn("col-active", "deck-1"),
      makeColumn("col-b", "deck-1"),
    ];
    await data.refreshDeck();

    await data.moveColumn("col-b", 0);
    expect(state.moveColumnCalls).toEqual([{ id: "col-b", position: 0 }]);

    await data.history.undo();
    expect(state.moveColumnCalls.at(-1)).toEqual({ id: "col-b", position: 1 });

    await data.history.redo();
    expect(state.moveColumnCalls.at(-1)).toEqual({ id: "col-b", position: 0 });
  });

  it("moveCardToColumn undo moves the card back to its original column and index", async () => {
    state.columns = [
      makeColumn("col-active", "deck-1"),
      makeColumn("col-b", "deck-1"),
    ];
    state.cardsByColumn = new Map([
      ["col-active", [makeCard("card-x", "col-active")]],
      ["col-b", []],
    ]);
    await data.refreshDeck();

    await data.moveCardToColumn("card-x", "col-b");
    expect(state.moveCardToColumnCalls).toEqual([
      { id: "card-x", columnId: "col-b" },
    ]);

    await data.history.undo();
    expect(state.moveCardToColumnCalls.at(-1)).toEqual({
      id: "card-x",
      columnId: "col-active",
    });
    expect(state.moveCardCalls).toEqual([{ id: "card-x", position: 0 }]);

    await data.history.redo();
    expect(state.moveCardToColumnCalls.at(-1)).toEqual({
      id: "card-x",
      columnId: "col-b",
    });
  });

  it("selectDeck clears the undo/redo history", async () => {
    await data.deleteCard("card-1");
    expect(data.history.canUndo).toBe(true);

    state.decks = [makeDeck("deck-1"), makeDeck("deck-2")];
    await data.selectDeck(state.decks[1]);

    expect(data.history.canUndo).toBe(false);
  });

  it("a mutation in flight during a deck switch never records history for the new deck", async () => {
    state.decks = [makeDeck("deck-1"), makeDeck("deck-2")];
    state.columns = [makeColumn("col-2", "deck-2")];
    state.cardsByColumn = new Map([["col-2", []]]);

    // Hold up saveCard's DB round-trip until after the deck switch completes.
    let releaseSave: () => void = () => {};
    const gate = new Promise<void>((resolve) => (releaseSave = resolve));
    const original = mockBackend.updateCardContent!;
    mockBackend.updateCardContent = async (id, content) => {
      await gate;
      return original(id, content);
    };

    const savePromise = data.saveCard("card-1", "edited while switching");
    await data.selectDeck(state.decks[1]);
    expect(data.history.canUndo).toBe(false);

    releaseSave();
    await savePromise;

    // The stale save must not have pushed onto deck-2's fresh history.
    expect(data.history.canUndo).toBe(false);

    mockBackend.updateCardContent = original;
  });

  it("undo surfaces a rejected effect and restores the entry for a retry", async () => {
    const ok = await data.deleteCard("card-1");
    expect(ok).toBe(true);
    expect(data.history.canUndo).toBe(true);

    const original = mockBackend.restoreCard!;
    mockBackend.restoreCard = async () => {
      throw new Error("db unavailable");
    };

    await expect(data.history.undo()).rejects.toThrow("db unavailable");
    // The entry must still be undoable — it was never silently dropped or
    // moved to the redo stack despite the failure.
    expect(data.history.canUndo).toBe(true);
    expect(data.history.canRedo).toBe(false);

    mockBackend.restoreCard = original;
    await data.history.undo();
    expect(state.restoreCardCalls).toEqual(["card-1"]);
  });
});

describe("DeckData card edit sessions", () => {
  // Lock/lease mechanics are unit-tested in cardEditSessions.test.ts; these
  // cover DeckData's board updates and error reporting around them.
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    seedSingleDeck();
    data = new DeckData();
    await data.init();
  });

  it("GUI :w retains its unique session lock and :wq atomically releases it", async () => {
    state.cardsByColumn = new Map([
      ["col-active", [makeCard("card-1", "col-active", { content: "old" })]],
    ]);
    await data.refreshDeck();

    const session = await data.startCardEdit("card-1");
    expect(session).not.toBeNull();
    expect(await data.saveCardEdit(session!, "new content")).toBe(true);
    expect(data.cardsByColumn["col-active"][0].content).toBe("new content");
    expect(await data.saveCardEdit(session!, "final content", true)).toBe(true);
    expect(data.cardsByColumn["col-active"][0].content).toBe("final content");
  });

  it("GUI edit cancellation releases the lock without changing content", async () => {
    state.cardsByColumn = new Map([
      ["col-active", [makeCard("card-1", "col-active", { content: "old" })]],
    ]);
    await data.refreshDeck();

    const session = await data.startCardEdit("card-1");
    expect(session).not.toBeNull();
    await data.cancelCardEdit(session!);
    expect(data.cardsByColumn["col-active"][0].content).toBe("old");
  });

  it("releases the lock on both cancellation and normal edit completion", async () => {
    const original = mockBackend.releaseCardLock!;
    const releaseCardLock = vi.fn(original);
    mockBackend.releaseCardLock = releaseCardLock;

    const first = await data.startCardEdit("card-1");
    await data.cancelCardEdit(first!);
    expect(releaseCardLock).toHaveBeenCalledWith("card-1", first!.owner);

    const second = await data.startCardEdit("card-1");
    expect(second!.owner).not.toBe(first!.owner);
    await data.finishCardEdit(second!);
    expect(releaseCardLock).toHaveBeenCalledTimes(2);
    mockBackend.releaseCardLock = original;
  });

  it("reports a lock acquisition conflict without entering edit state", async () => {
    const original = mockBackend.acquireCardLock;
    mockBackend.acquireCardLock = async () => {
      throw new Error("Card is locked by another editor");
    };

    expect(await data.startCardEdit("card-1")).toBeNull();
    expect(data.error).toContain("Card is locked by another editor");
    mockBackend.acquireCardLock = original;
  });

  it("rejects GUI save requests that did not acquire an edit lock", async () => {
    expect(
      await data.saveCardEdit(
        { cardId: "card-1", owner: "missing", expectedUpdatedAt: "never" },
        "new content",
      ),
    ).toBe(false);
    expect(data.error).toBe("Cannot save card: edit lock is not held");
  });

  it("retains the session lock when saving fails so it can be retried", async () => {
    const original = mockBackend.updateCardContentCasOwned;
    mockBackend.updateCardContentCasOwned = async () => {
      throw new Error("Card was modified since it was read");
    };

    const session = await data.startCardEdit("card-1");
    expect(await data.saveCardEdit(session!, "new content")).toBe(false);
    expect(data.error).toContain("Card was modified since it was read");
    mockBackend.updateCardContentCasOwned = original;
    expect(await data.saveCardEdit(session!, "new content")).toBe(true);
    await data.finishCardEdit(session!);
  });

  it("keeps a session after a failed release so it can be retried", async () => {
    const original = mockBackend.releaseCardLock;
    mockBackend.releaseCardLock = async () => {
      throw new Error("temporary failure");
    };
    const session = await data.startCardEdit("card-1");

    expect(await data.finishCardEdit(session!)).toBe(false);
    mockBackend.releaseCardLock = original;
    expect(await data.finishCardEdit(session!)).toBe(true);
  });
});

describe("DeckData new cards", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    seedSingleDeck();
    data = new DeckData();
    await data.init();
  });

  async function editNewCard() {
    const card = await data.createNewCard("col-active");
    const session = await data.startCardEdit(card!.id);
    return { card: card!, session: session! };
  }

  it("discards a new card dismissed while empty, bypassing trash and history", async () => {
    const { card, session } = await editNewCard();

    expect(await data.cancelCardEdit(session)).toBe(true);

    expect(state.discardEmptyCardCalls).toEqual([card.id]);
    expect(state.deleteCardCalls).toEqual([]);
    expect(data.cardsByColumn["col-active"]).toEqual([]);
    expect(data.history.canUndo).toBe(false);
  });

  it("discards a new card saved and closed with only whitespace", async () => {
    const { card, session } = await editNewCard();

    expect(await data.saveCardEdit(session, "  \n", true)).toBe(true);

    expect(state.discardEmptyCardCalls).toEqual([card.id]);
    expect(data.history.canUndo).toBe(false);
  });

  it("records a single create when a new card is first saved with content", async () => {
    const { card, session } = await editNewCard();
    expect(data.history.canUndo).toBe(false);

    expect(await data.saveCardEdit(session, "idea", true)).toBe(true);
    expect(state.discardEmptyCardCalls).toEqual([]);

    await data.history.undo();
    expect(state.deleteCardCalls).toEqual([card.id]);
    expect(data.history.canUndo).toBe(false);
  });

  it("keeps a new card once it has been saved with content", async () => {
    const { card, session } = await editNewCard();
    expect(await data.saveCardEdit(session, "idea")).toBe(true);

    expect(await data.cancelCardEdit(session)).toBe(true);

    expect(state.discardEmptyCardCalls).toEqual([]);
    expect(data.cardsByColumn["col-active"].map((c) => c.id)).toEqual([card.id]);
  });

  it("keeps an existing empty card when its edit is dismissed", async () => {
    state.cardsByColumn = new Map([
      ["col-active", [makeCard("card-1", "col-active", { content: "" })]],
    ]);
    await data.refreshDeck();
    const session = await data.startCardEdit("card-1");

    expect(await data.cancelCardEdit(session!)).toBe(true);

    expect(state.discardEmptyCardCalls).toEqual([]);
    expect(data.cardsByColumn["col-active"]).toHaveLength(1);
  });

  it("keeps the session when discarding fails so it can be retried", async () => {
    const original = mockBackend.discardEmptyCard;
    mockBackend.discardEmptyCard = async () => {
      throw new Error("temporary failure");
    };
    const { session } = await editNewCard();

    expect(await data.cancelCardEdit(session)).toBe(false);
    expect(data.error).toContain("Failed to discard empty card");
    mockBackend.discardEmptyCard = original;
    expect(await data.cancelCardEdit(session)).toBe(true);
  });
});

describe("DeckData refreshDeck", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    seedSingleDeck();
    data = new DeckData();
    await data.init();
  });

  it("refreshDeck reloads columns, cards, and tags for the current deck", async () => {
    state.columns = [makeColumn("col-x", "deck-1")];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("card-x", "col-x", { content: "hi" })]],
    ]);
    state.tagsByDeck = [{ id: "t1", name: "todo" }];

    await data.refreshDeck();

    expect(data.columns.map((c) => c.id)).toEqual(["col-x"]);
    expect(data.cardsByColumn["col-x"].map((c) => c.id)).toEqual(["card-x"]);
    expect(data.deckTags).toEqual([{ id: "t1", name: "todo" }]);
  });

  it("refreshDeck makes no backend calls when no current deck", async () => {
    data.currentDeck = null;
    const before = state.getTagsByDeckCalls;
    await expect(data.refreshDeck()).resolves.toBe(false);
    expect(state.getTagsByDeckCalls).toBe(before);
  });

  it("re-applies an active tag filter after an external reload", async () => {
    state.columns = [makeColumn("col-x", "deck-1")];
    state.cardsByColumn = new Map([
      ["col-x", [makeCard("c1", "col-x", { content: "#todo x" })]],
    ]);
    data.filterByTag("todo");

    await data.refreshDeck();

    expect(data.activeTagFilter).toBe("todo");
    expect(data.filteredCardIds?.has("c1")).toBe(true);
  });

  it("discards an external reload when the deck changes mid-flight", async () => {
    const originalColumns = data.columns;
    // deck-1's post-reload set — should NOT be committed once the deck switches.
    state.columns = [makeColumn("col-new", "deck-1")];
    state.cardsByColumn = new Map([["col-new", []]]);

    // Flip the selected deck during the final await so the guard discards.
    const originalGetTags = mockBackend.getTagsByDeck!;
    mockBackend.getTagsByDeck = async () => {
      data.currentDeck = makeDeck("deck-2");
      return [];
    };

    await data.refreshDeck();
    mockBackend.getTagsByDeck = originalGetTags;

    // Columns were not overwritten with the stale (deck-1) fetch.
    expect(data.columns).toBe(originalColumns);
  });

  it("refreshDeck ignores a successful result for a deck that is no longer active", async () => {
    const staleColumn = makeColumn("col-deck-1-stale", "deck-1");
    const otherDeck = makeDeck("deck-2");
    const otherColumn = makeColumn("col-deck-2", "deck-2");
    let resolveReload!: (columns: Column[]) => void;
    const reloadStarted = new Promise<void>((resolve) => {
      vi.spyOn(mockBackend, "getColumnsByDeck").mockImplementationOnce(
        () =>
          new Promise((reloadResolve) => {
            resolveReload = reloadResolve;
            resolve();
          }),
      );
    });

    const reloading = data.refreshDeck();
    await reloadStarted;
    data.currentDeck = otherDeck;
    data.columns = [otherColumn];
    data.cardsByColumn = { [otherColumn.id]: [] };
    resolveReload([staleColumn]);

    await expect(reloading).resolves.toBe(false);
    expect(data.columns).toEqual([otherColumn]);
    expect(data.cardsByColumn).toEqual({ [otherColumn.id]: [] });
  });

  it("refreshDeck ignores a deck switch while loading cards", async () => {
    const staleColumn = makeColumn("col-deck-1-stale", "deck-1");
    const otherDeck = makeDeck("deck-2");
    const otherColumn = makeColumn("col-deck-2", "deck-2");
    let resolveCards!: (cards: Card[]) => void;
    const cardsStarted = new Promise<void>((resolve) => {
      vi.spyOn(mockBackend, "getCardsByColumn").mockImplementationOnce(
        () =>
          new Promise((cardsResolve) => {
            resolveCards = cardsResolve;
            resolve();
          }),
      );
    });
    vi.spyOn(mockBackend, "getColumnsByDeck").mockResolvedValueOnce([staleColumn]);

    const reloading = data.refreshDeck();
    await cardsStarted;
    data.currentDeck = otherDeck;
    data.columns = [otherColumn];
    data.cardsByColumn = { [otherColumn.id]: [] };
    resolveCards([]);

    await expect(reloading).resolves.toBe(false);
    expect(data.columns).toEqual([otherColumn]);
    expect(data.cardsByColumn).toEqual({ [otherColumn.id]: [] });
  });

  it("refreshDeck keeps the loaded board when a card fetch fails", async () => {
    const before = { ...data.cardsByColumn };
    const columnsBefore = data.columns;
    vi.spyOn(mockBackend, "getCardsByColumn").mockRejectedValueOnce(new Error("db gone"));

    await expect(data.refreshDeck()).resolves.toBe(false);
    expect(data.columns).toBe(columnsBefore);
    expect(data.cardsByColumn).toEqual(before);
    expect(data.error).toContain("Failed to reload deck");
  });
});

describe("DeckData tags", () => {
  let data: InstanceType<typeof DeckData>;

  beforeEach(async () => {
    seedSingleDeck();
    data = new DeckData();
    await data.init();
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
    await data.refreshDeck();

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
});

describe("DeckData external change wiring", () => {
  type StreamEvent = {
    kind: "begin" | "delta" | "end";
    card_id: string;
    column_id?: string;
    chunk?: string;
  };

  let data: InstanceType<typeof DeckData>;
  /** Handlers registered by watchExternalChanges, keyed by event name. */
  let handlers: Record<string, (() => void) | undefined>;
  let unlisten: ReturnType<typeof vi.fn<() => void>>;

  /** Deliver one `reporter-stream` payload the way the Tauri event bus would. */
  function emit(e: StreamEvent): void {
    const handler = handlers["reporter-stream"] as unknown as
      | ((event: { payload: StreamEvent }) => void)
      | undefined;
    handler?.({ payload: e });
  }

  beforeEach(async () => {
    seedSingleDeck();
    mockEnv.tauri = true;
    handlers = {};
    unlisten = vi.fn();
    mockListen.mockImplementation(async (event: string, h: () => void) => {
      handlers[event] = h;
      return unlisten;
    });

    data = new DeckData();
    await data.init();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockEnv.tauri = false;
    mockListen.mockReset();
    mockListen.mockImplementation(async () => () => {});
  });

  it("watchExternalChanges is a no-op outside Tauri (no reconcile tick)", async () => {
    mockEnv.tauri = false;
    await expect(data.watchExternalChanges()).resolves.toBeUndefined();
    expect(data.externalChangeTick).toBe(0);
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("watchExternalChanges subscribes to every channel and reconciles once under Tauri", async () => {
    await data.watchExternalChanges();

    expect(Object.keys(handlers)).toEqual([
      "external-db-change",
      "reporter-change",
      "reporter-stream",
    ]);
    // A reconcile tick fires right after subscribing.
    expect(data.externalChangeTick).toBe(1);
  });

  it("funnels DB and reporter commits into one debounced externalChangeTick", async () => {
    await data.watchExternalChanges();
    const tick = data.externalChangeTick;

    handlers["external-db-change"]?.();
    handlers["reporter-change"]?.();
    vi.advanceTimersByTime(250);

    expect(data.externalChangeTick).toBe(tick + 1);
  });

  it("exposes stream overlay state through isStreaming and streamingText", async () => {
    await data.watchExternalChanges();
    expect(data.isStreaming("card-1")).toBe(false);

    emit({ kind: "begin", card_id: "card-1" });
    expect(data.isStreaming("card-1")).toBe(true);

    emit({ kind: "delta", card_id: "card-1", chunk: "Hello" });
    vi.advanceTimersByTime(20); // run the animation-frame flush
    expect(data.streamingText["card-1"]).toBe("Hello");
  });

  it("end reloads the streamed card's column and tags, then drops the overlay", async () => {
    await data.watchExternalChanges();
    state.cardsByColumn = new Map([
      ["col-active", [makeCard("card-1", "col-active", { content: "final #done" })]],
    ]);
    state.tagsByDeck = [{ id: "t1", name: "done" }];
    emit({ kind: "begin", card_id: "card-1" });
    const tagCalls = state.getTagsByDeckCalls;

    emit({ kind: "end", card_id: "card-1", column_id: "col-active" });
    await vi.runAllTimersAsync();

    expect(data.cardsByColumn["col-active"].map((c) => c.content)).toEqual([
      "final #done",
    ]);
    expect(state.getTagsByDeckCalls).toBe(tagCalls + 1);
    expect(data.isStreaming("card-1")).toBe(false);
  });

  it("end for a column outside the loaded board requests a full reconcile", async () => {
    await data.watchExternalChanges();
    emit({ kind: "begin", card_id: "card-1" });
    const tick = data.externalChangeTick;
    const tagCalls = state.getTagsByDeckCalls;

    emit({ kind: "end", card_id: "card-1", column_id: "col-elsewhere" });
    await vi.runAllTimersAsync();

    expect(data.externalChangeTick).toBe(tick + 1);
    expect(state.getTagsByDeckCalls).toBe(tagCalls);
    expect(data.isStreaming("card-1")).toBe(false);
  });

  it("end without a column id falls back to a full reconcile", async () => {
    await data.watchExternalChanges();
    emit({ kind: "begin", card_id: "card-1" });
    const tick = data.externalChangeTick;

    emit({ kind: "end", card_id: "card-1" });
    await vi.runAllTimersAsync();

    expect(data.externalChangeTick).toBe(tick + 1);
    expect(data.isStreaming("card-1")).toBe(false);
  });

  it("drops the overlay and reports an error when the post-stream reload fails", async () => {
    await data.watchExternalChanges();
    const original = mockBackend.getCardsByColumn!;
    mockBackend.getCardsByColumn = async () => {
      throw new Error("db gone");
    };
    emit({ kind: "begin", card_id: "card-1" });

    emit({ kind: "end", card_id: "card-1", column_id: "col-active" });
    await vi.runAllTimersAsync();
    mockBackend.getCardsByColumn = original;

    // A failed reload must not leave the card stuck read-only.
    expect(data.isStreaming("card-1")).toBe(false);
    expect(data.error).toContain("Failed to reload deck");
  });

  it("stopWatchingExternalChanges unsubscribes, cancels a pending tick, and clears overlays", async () => {
    await data.watchExternalChanges();
    const tick = data.externalChangeTick;
    emit({ kind: "begin", card_id: "card-1" });
    emit({ kind: "delta", card_id: "card-1", chunk: "unflushed" });
    handlers["external-db-change"]?.(); // schedule a debounced tick…

    data.stopWatchingExternalChanges(); // …then cancel it before it fires
    vi.advanceTimersByTime(60_000);

    expect(unlisten).toHaveBeenCalledTimes(3);
    expect(data.externalChangeTick).toBe(tick);
    expect(data.streamingText).toEqual({});
    expect(data.isStreaming("card-1")).toBe(false);
  });

  it("stopWatchingExternalChanges is safe when nothing is subscribed", () => {
    expect(() => data.stopWatchingExternalChanges()).not.toThrow();
  });
});

describe("DeckData reporter registry", () => {
  let data: InstanceType<typeof DeckData>;

  const config: ReporterConfig = {
    reporter_id: "rep-1",
    name: "Minutes",
    command: "/opt/whisper",
    args: [],
    env: {},
    deny: [],
    max_writes_per_min: null,
    allowed_columns: null,
  };

  beforeEach(async () => {
    resetState();
    state.decks = [makeDeck("deck-1")];
    state.columns = [makeColumn("col-active", "deck-1")];
    state.cardsByColumn = new Map([["col-active", []]]);

    data = new DeckData();
    await data.init();
  });

  it("passes every reporter operation straight to the backend", async () => {
    state.reporters = [config];
    state.runningReporters = ["rep-1"];

    expect(await data.listReporters("deck-1")).toEqual([config]);
    expect(await data.listRunningReporters()).toEqual(["rep-1"]);
    expect((await data.addReporter("deck-1", config)).reporter_id).toBe(
      "assigned-id",
    );
    await data.updateReporter("deck-1", config);
    await data.startReporter("deck-1", "rep-1");
    await data.stopReporter("rep-1");
    await data.removeReporter("deck-1", "rep-1");

    expect(state.reporterCalls).toEqual([
      ["listReporters", "deck-1"],
      ["listRunningReporters"],
      ["addReporter", "deck-1", "Minutes"],
      ["updateReporter", "deck-1", "rep-1"],
      ["startReporter", "deck-1", "rep-1"],
      ["stopReporter", "rep-1"],
      ["removeReporter", "deck-1", "rep-1"],
    ]);
  });

  it("re-throws instead of funnelling into the board-wide error banner", async () => {
    const original = mockBackend.startReporter!;
    mockBackend.startReporter = async () => {
      throw new Error("ENOENT");
    };

    // The registration dialog reports failures inline per row, so DeckData must
    // not swallow them into `this.error` the way the board operations do.
    await expect(data.startReporter("deck-1", "rep-1")).rejects.toThrow("ENOENT");
    expect(data.error).toBeNull();

    mockBackend.startReporter = original;
  });
});
