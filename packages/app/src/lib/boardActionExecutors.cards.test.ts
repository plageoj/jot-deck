import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DeckData } from "#lib/deckData.svelte.ts";
import type { FocusManager } from "#lib/focusManager.svelte.ts";
import type { BoardActionExecutors } from "#lib/boardActionExecutors.ts";
import { makeCard, makeColumn } from "./__fixtures__/models";
import { boardState } from "./__fixtures__/boardBackend";
import { createBoardActions, setupBoard } from "./__fixtures__/boardHarness";

// Card operations executed by BoardActionExecutors, regardless of the focus
// mode they are invoked from: creation, edit-start requests, deletion,
// reordering, cross-column moves, clipboard, and scoring.

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/boardBackend");
  return { getDatabase: async () => mockBackend };
});

describe("card operations", () => {
  let data: DeckData;
  let focus: FocusManager;
  let actions: BoardActionExecutors;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard({
      columns: [
        makeColumn("col-0", "deck-1", { position: 0 }),
        makeColumn("col-1", "deck-1", { position: 1 }),
      ],
      cards: {
        "col-0": [
          makeCard("c-0-a", "col-0"),
          makeCard("c-0-b", "col-0"),
          makeCard("c-0-c", "col-0"),
        ],
        "col-1": [makeCard("c-1-a", "col-1")],
      },
    }));
    focus.focusMode = "card";
    focus.focusedColumnIndex = 0;
    focus.focusedCardIndex = 1;
    actions = createBoardActions(data, focus);
  });

  describe("creation", () => {
    it("createCard from column focus creates a card in the focused column and hands it to startEdit", async () => {
      const startEdit = vi.fn();
      actions = createBoardActions(data, focus, { startEdit });
      focus.focusMode = "column";
      focus.focusedColumnIndex = 1;
      await actions.executeColumnAction("createCard");
      expect(boardState.createCardCalls).toHaveLength(1);
      expect(boardState.createCardCalls[0].column_id).toBe("col-1");
      expect(startEdit).toHaveBeenCalledWith("created-card-1");
      expect(focus.focusMode).toBe("card");
    });

    it.each([
      ["createCardBelow", 2],
      ["createCardAbove", 1],
    ])("%s inserts at position %i and hands the card to startEdit", async (action, position) => {
      const startEdit = vi.fn();
      actions = createBoardActions(data, focus, { startEdit });
      await actions.executeCardAction(action);
      expect(boardState.createCardCalls[0]?.position).toBe(position);
      expect(startEdit).toHaveBeenCalledWith("created-card-1");
    });

    it("hands the created card to the startEdit callback from either focus mode", async () => {
      const startEdit = vi.fn();
      actions = createBoardActions(data, focus, { startEdit });

      await actions.executeCardAction("createCardBelow");
      focus.focusMode = "column";
      await actions.executeColumnAction("createCard");

      expect(startEdit.mock.calls).toEqual([["created-card-1"], ["created-card-2"]]);
      expect(focus.focusMode).toBe("card");
    });
  });

  describe("edit start", () => {
    it("startEdit runs the startEdit callback as a task when one is provided", async () => {
      const startEdit = vi.fn();
      const tasks: Promise<unknown>[] = [];
      actions = createBoardActions(data, focus, {
        startEdit,
        runTask: (task) => tasks.push(task),
      });

      await actions.executeCardAction("startEdit");
      await Promise.all(tasks);

      expect(startEdit).toHaveBeenCalledWith("c-0-b", "start");
      expect(focus.focusMode).toBe("card");
    });

    it("startEditAtEnd asks the startEdit callback to place the cursor at the end", async () => {
      const startEdit = vi.fn();
      const tasks: Promise<unknown>[] = [];
      actions = createBoardActions(data, focus, {
        startEdit,
        runTask: (task) => tasks.push(task),
      });

      await actions.executeCardAction("startEditAtEnd");
      await Promise.all(tasks);

      expect(startEdit).toHaveBeenCalledWith("c-0-b", "end");
    });

    it("startEdit is ignored while the focused card is receiving a Reporter stream", async () => {
      data.streamingText = { "c-0-b": "partial" };
      await actions.executeCardAction("startEdit");
      expect(focus.focusMode).toBe("card");
      expect(focus.editingCardId).toBeNull();
    });
  });

  describe("deletion", () => {
    it("deleteCard calls db.deleteCard for the focused card", async () => {
      await actions.executeCardAction("deleteCard");
      expect(boardState.deleteCardCalls).toContain("c-0-b");
    });

    it("deleteCard exits to column mode when the column becomes empty", async () => {
      focus.focusedColumnIndex = 1; // col-1 has a single card
      focus.focusedCardIndex = 0;
      await actions.executeCardAction("deleteCard");
      expect(boardState.deleteCardCalls).toContain("c-1-a");
      expect(focus.focusMode).toBe("column");
    });
  });

  describe("reordering", () => {
    it("reorderCardDown calls db.moveCard with index+1", async () => {
      await actions.executeCardAction("reorderCardDown");
      expect(boardState.moveCardCalls[0]).toEqual({ id: "c-0-b", position: 2 });
    });

    it("reorderCardUp calls db.moveCard with index-1", async () => {
      await actions.executeCardAction("reorderCardUp");
      expect(boardState.moveCardCalls[0]).toEqual({ id: "c-0-b", position: 0 });
    });

    it("reorderCardDown wraps the last card to the top", async () => {
      focus.focusedCardIndex = 2;
      await actions.executeCardAction("reorderCardDown");
      expect(boardState.moveCardCalls[0]).toEqual({ id: "c-0-c", position: 0 });
      expect(focus.focusedCardIndex).toBe(0);
    });

    it("reorderCardUp wraps the first card to the bottom", async () => {
      focus.focusedCardIndex = 0;
      await actions.executeCardAction("reorderCardUp");
      expect(boardState.moveCardCalls[0]).toEqual({ id: "c-0-a", position: 2 });
      expect(focus.focusedCardIndex).toBe(2);
    });

    it("reordering keeps focus when the move fails", async () => {
      vi.spyOn(data, "moveCard").mockResolvedValue(false);
      focus.focusedCardIndex = 2;
      await actions.executeCardAction("reorderCardDown");
      expect(focus.focusedCardIndex).toBe(2);
    });

    it("reordering is a no-op when no card is focused", async () => {
      focus.focusedCardIndex = 5; // out of range → no focused card
      await actions.executeCardAction("reorderCardUp");
      expect(boardState.moveCardCalls).toHaveLength(0);
    });

    it("reordering is a no-op in a single-card column", async () => {
      focus.focusedColumnIndex = 1;
      focus.focusedCardIndex = 0;
      await actions.executeCardAction("reorderCardDown");
      expect(boardState.moveCardCalls).toHaveLength(0);
    });
  });

  describe("cross-column moves", () => {
    it("moveCardLeft moves the focused card to the previous column", async () => {
      focus.focusedColumnIndex = 1;
      focus.focusedCardIndex = 0;
      await actions.executeCardAction("moveCardLeft");
      expect(boardState.moveCardToColumnCalls[0]).toEqual({
        id: "c-1-a",
        column_id: "col-0",
      });
      expect(focus.focusedColumnIndex).toBe(0);
    });

    it("moveCardLeft wraps from the first column to the last", async () => {
      await actions.executeCardAction("moveCardLeft");
      expect(boardState.moveCardToColumnCalls[0]).toEqual({
        id: "c-0-b",
        column_id: "col-1",
      });
      expect(focus.focusedColumnIndex).toBe(1);
    });

    it("moveCardRight is a no-op when no card is focused", async () => {
      focus.focusedCardIndex = 5; // out of range → no focused card
      await actions.executeCardAction("moveCardRight");
      expect(boardState.moveCardToColumnCalls).toHaveLength(0);
    });

    it("moveCardRight keeps focus when the move fails", async () => {
      vi.spyOn(data, "moveCardToColumn").mockResolvedValue(false);
      await actions.executeCardAction("moveCardRight");
      expect(focus.focusedColumnIndex).toBe(0);
    });

    it("moveCardLeft is a no-op when the deck has a single column", async () => {
      data.columns = [data.columns[0]];
      await actions.executeCardAction("moveCardLeft");
      expect(boardState.moveCardToColumnCalls).toHaveLength(0);
    });

    it("moveCardRight moves the focused card to the next column", async () => {
      focus.focusedCardIndex = 0;
      await actions.executeCardAction("moveCardRight");
      expect(boardState.moveCardToColumnCalls[0].column_id).toBe("col-1");
      expect(focus.focusedColumnIndex).toBe(1);
    });

    it("moveCardRight wraps from the last column to the first", async () => {
      focus.focusedColumnIndex = 1;
      focus.focusedCardIndex = 0;
      await actions.executeCardAction("moveCardRight");
      expect(boardState.moveCardToColumnCalls[0]).toEqual({
        id: "c-1-a",
        column_id: "col-0",
      });
      expect(focus.focusedColumnIndex).toBe(0);
    });
  });

  describe("clipboard", () => {
    it("copyCard puts a snapshot of the focused card on the clipboard", async () => {
      await actions.executeCardAction("copyCard");
      expect(focus.clipboardCard?.id).toBe("c-0-b");
    });

    it("pasteBelow creates a card after the focused card from clipboard", async () => {
      focus.clipboardCard = { ...makeCard("clip", "col-0"), content: "pasted" };
      await actions.executeCardAction("pasteBelow");
      expect(boardState.createCardCalls[0]?.content).toBe("pasted");
    });

    it("pasteAbove creates a card at the focused index from the clipboard", async () => {
      focus.clipboardCard = { ...makeCard("clip", "col-0"), content: "above" };
      await actions.executeCardAction("pasteAbove");
      expect(boardState.createCardCalls[0]?.content).toBe("above");
      expect(boardState.createCardCalls[0]?.position).toBe(1);
    });

    it("pasteBelow/pasteAbove are no-ops with an empty clipboard", async () => {
      focus.clipboardCard = null;
      await actions.executeCardAction("pasteAbove");
      await actions.executeCardAction("pasteBelow");
      expect(boardState.createCardCalls).toHaveLength(0);
    });
  });

  describe("system clipboard", () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("copyCardText writes the focused card's content without touching the app clipboard", async () => {
      focus.clipboardCard = null;
      await actions.executeCardAction("copyCardText");
      expect(writeText).toHaveBeenCalledWith(data.cardsByColumn["col-0"][1].content);
      expect(focus.clipboardCard).toBeNull();
      expect(boardState.deleteCardCalls).toHaveLength(0);
    });

    it("cutCardText writes the content and deletes the focused card", async () => {
      await actions.executeCardAction("cutCardText");
      expect(writeText).toHaveBeenCalledOnce();
      expect(boardState.deleteCardCalls).toContain("c-0-b");
    });

    it("cutCardText deletes the copied card even if focus moves during the write", async () => {
      let finishWrite!: () => void;
      writeText.mockReturnValue(new Promise<void>((resolve) => (finishWrite = resolve)));
      const cut = actions.executeCardAction("cutCardText");
      focus.focusedCardIndex = 2;
      finishWrite();
      await cut;
      expect(writeText).toHaveBeenCalledWith("c-0-b content");
      expect(boardState.deleteCardCalls).toEqual(["c-0-b"]);
      // c-0-c shifted up when c-0-b was deleted; focus stays on it.
      expect(data.cardsByColumn["col-0"][focus.focusedCardIndex]?.id).toBe("c-0-c");
    });

    it("cutCardText keeps the card the user picks while the delete is pending", async () => {
      // Cut c-0-a; move to c-0-c during the write, then to c-0-b during the delete.
      focus.focusedCardIndex = 0;
      let finishWrite!: () => void;
      writeText.mockReturnValue(new Promise<void>((resolve) => (finishWrite = resolve)));
      const realDelete = data.deleteCard.bind(data);
      let deleteStarted!: () => void;
      const started = new Promise<void>((resolve) => (deleteStarted = resolve));
      let releaseDelete!: () => void;
      const gate = new Promise<void>((resolve) => (releaseDelete = resolve));
      vi.spyOn(data, "deleteCard").mockImplementation(async (id, record) => {
        deleteStarted();
        await gate;
        return realDelete(id, record);
      });

      const cut = actions.executeCardAction("cutCardText");
      focus.focusedCardIndex = 2;
      finishWrite();
      await started;
      focus.focusedCardIndex = 1;
      releaseDelete();
      await cut;

      expect(boardState.deleteCardCalls).toEqual(["c-0-a"]);
      expect(data.cardsByColumn["col-0"][focus.focusedCardIndex]?.id).toBe("c-0-b");
    });

    it("cutCardText leaves an opened palette alone when the cut finishes", async () => {
      // Cut the only card of col-1, then open a palette before the write ends.
      focus.focusedColumnIndex = 1;
      focus.focusedCardIndex = 0;
      let finishWrite!: () => void;
      writeText.mockReturnValue(new Promise<void>((resolve) => (finishWrite = resolve)));
      const cut = actions.executeCardAction("cutCardText");
      focus.focusMode = "command";
      finishWrite();
      await cut;
      expect(boardState.deleteCardCalls).toEqual(["c-1-a"]);
      expect(focus.focusMode).toBe("command");
    });

    it("cutCardText skips the delete when the deck changes during the write", async () => {
      let finishWrite!: () => void;
      writeText.mockReturnValue(new Promise<void>((resolve) => (finishWrite = resolve)));
      const cut = actions.executeCardAction("cutCardText");
      data.currentDeck = { ...data.currentDeck!, id: "deck-other" };
      finishWrite();
      await cut;
      expect(boardState.deleteCardCalls).toHaveLength(0);
    });

    it("cutCardText keeps the card and reports when the clipboard write fails", async () => {
      writeText.mockRejectedValue(new Error("denied"));
      await actions.executeCardAction("cutCardText");
      expect(boardState.deleteCardCalls).toHaveLength(0);
      expect(data.error).toMatch(/clipboard/);
    });

    it("copyCardText reports a failed clipboard write", async () => {
      writeText.mockRejectedValue(new Error("denied"));
      await actions.executeCardAction("copyCardText");
      expect(data.error).toMatch(/clipboard/);
    });

    it("pasteTextBelow creates one card below with normalized line endings", async () => {
      await actions.pasteTextBelow("\r\nfirst line\r\nsecond line\r\n");
      expect(boardState.createCardCalls).toHaveLength(1);
      expect(boardState.createCardCalls[0]?.content).toBe("first line\nsecond line");
      expect(boardState.createCardCalls[0]?.position).toBe(2);
      expect(focus.focusedCardIndex).toBe(2);
    });

    it("pasteTextBelow strips a long blank-line run quickly", async () => {
      const blank = "\n".repeat(200_000);
      const started = performance.now();
      await actions.pasteTextBelow(`${blank}x${blank}y${blank}`);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(boardState.createCardCalls[0]?.content).toBe(`x${blank}y`);
    });

    it("pasteTextBelow ignores blank text", async () => {
      await actions.pasteTextBelow("  \n\t ");
      expect(boardState.createCardCalls).toHaveLength(0);
    });
  });

  describe("scoring", () => {
    it("scoreUp invokes db.updateCardScore with +1", async () => {
      await actions.executeCardAction("scoreUp");
      expect(boardState.updateCardScoreCalls[0]).toEqual({ id: "c-0-b", delta: 1 });
    });

    it("scoreDown invokes db.updateCardScore with -1", async () => {
      await actions.executeCardAction("scoreDown");
      expect(boardState.updateCardScoreCalls[0]).toEqual({ id: "c-0-b", delta: -1 });
    });
  });
});
