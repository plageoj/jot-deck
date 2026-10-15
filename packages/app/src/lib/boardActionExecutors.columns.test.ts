import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Column } from "#lib/types.ts";
import type { DeckData } from "#lib/deckData.svelte.ts";
import type { FocusManager } from "#lib/focusManager.svelte.ts";
import type { BoardActionExecutors } from "#lib/boardActionExecutors.ts";
import { makeCard, makeColumn } from "./__fixtures__/models";
import { boardState } from "./__fixtures__/boardBackend";
import { createBoardActions, setupBoard } from "./__fixtures__/boardHarness";

// Column operations executed by BoardActionExecutors, regardless of the focus
// mode they are invoked from: creation, deletion, reordering, and rename
// requests.

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/boardBackend");
  return { getDatabase: async () => mockBackend };
});

describe("column operations from column focus", () => {
  let data: DeckData;
  let focus: FocusManager;
  let actions: BoardActionExecutors;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard({
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
    }));
    focus.focusMode = "column";
    focus.focusedColumnIndex = 1;
    actions = createBoardActions(data, focus);
  });

  it("createColumn delegates to data.createColumnAtPosition", async () => {
    await actions.executeColumnAction("createColumn");
    expect(boardState.createColumnCalls).toHaveLength(1);
  });

  it("deleteColumn calls db.deleteColumn for the focused column", async () => {
    await actions.executeColumnAction("deleteColumn");
    expect(boardState.deleteColumnCalls).toContain("col-1");
  });

  it("reorderColumnLeft moves the column when not at the start", async () => {
    await actions.executeColumnAction("reorderColumnLeft");
    expect(boardState.moveColumnCalls).toHaveLength(1);
    expect(boardState.moveColumnCalls[0].id).toBe("col-1");
  });

  it("reorderColumnLeft wraps the first column to the end", async () => {
    focus.focusedColumnIndex = 0;
    await actions.executeColumnAction("reorderColumnLeft");
    expect(boardState.moveColumnCalls[0]).toEqual({ id: "col-0", position: 2 });
    expect(focus.focusedColumnIndex).toBe(2);
  });

  it("reorderColumnRight wraps the last column to the start", async () => {
    focus.focusedColumnIndex = 2;
    await actions.executeColumnAction("reorderColumnRight");
    expect(boardState.moveColumnCalls[0]).toEqual({ id: "col-2", position: 0 });
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("reordering is a no-op when no column is focused", async () => {
    focus.focusedColumnIndex = 5; // out of range → no focused column
    await actions.executeColumnAction("reorderColumnLeft");
    expect(boardState.moveColumnCalls).toHaveLength(0);
  });

  it("reordering keeps focus when the move fails", async () => {
    vi.spyOn(data, "moveColumn").mockResolvedValue(false);
    await actions.executeColumnAction("reorderColumnRight");
    expect(focus.focusedColumnIndex).toBe(1);
  });

  it("reordering is a no-op when the deck has a single column", async () => {
    data.columns = [data.columns[0]];
    focus.focusedColumnIndex = 0;
    await actions.executeColumnAction("reorderColumnRight");
    expect(boardState.moveColumnCalls).toHaveLength(0);
  });

  it("reorderColumnRight moves the column when not at the end", async () => {
    await actions.executeColumnAction("reorderColumnRight");
    expect(boardState.moveColumnCalls).toHaveLength(1);
  });

  it("renameColumn requests a rename from column and card focus", async () => {
    const renameColumn = vi.fn();
    actions = createBoardActions(data, focus, { renameColumn });
    await actions.executeColumnAction("renameColumn");
    await actions.executeCardAction("renameColumn");
    expect(renameColumn).toHaveBeenCalledTimes(2);
  });
});

describe("column creation from card focus", () => {
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

  it("createColumn inserts a column after the focused column", async () => {
    await actions.executeCardAction("createColumn");
    expect(boardState.createColumnCalls[0]?.position).toBe(1);
    expect(focus.focusedColumnIndex).toBe(1);
    expect(data.columns[focus.focusedColumnIndex]?.id).toBe("created-1");
    expect(focus.focusMode).toBe("column");
  });

  it("createColumn keeps card focus when the column cannot be created", async () => {
    vi.spyOn(data, "createColumnAtPosition").mockResolvedValue(null);

    await actions.executeCardAction("createColumn");

    expect(focus.focusMode).toBe("card");
    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.focusedCardIndex).toBe(1);
  });

  it("createColumn keeps card focus when the created column is not loaded", async () => {
    vi.spyOn(data, "createColumnAtPosition").mockResolvedValue(
      makeColumn("missing-column", "deck-1", { position: 1 }),
    );

    await actions.executeCardAction("createColumn");

    expect(focus.focusMode).toBe("card");
    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.focusedCardIndex).toBe(1);
  });

  it("createColumn preserves a later edit-mode transition", async () => {
    let resolveColumn: (column: Column | null) => void;
    const createdColumn = makeColumn("created-async", "deck-1", { position: 1 });
    const createColumn = new Promise<Column | null>((resolve) => {
      resolveColumn = resolve;
    });
    vi.spyOn(data, "createColumnAtPosition").mockReturnValue(createColumn);

    const creating = actions.executeCardAction("createColumn");
    await actions.executeCardAction("startEdit");
    data.columns = [...data.columns, createdColumn];
    resolveColumn!(createdColumn);
    await creating;

    expect(focus.focusMode).toBe("edit");
    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.editingCardId).toBe("c-0-b");
  });

  it("createColumnFromPalette preserves card focus when the resulting column has cards", async () => {
    const created = data.columns[1];
    const createColumnAtPosition = vi
      .spyOn(data, "createColumnAtPosition")
      .mockResolvedValue(created);

    await actions.createColumnFromPalette();

    expect(createColumnAtPosition).toHaveBeenCalledWith(1);
    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.focusMode).toBe("card");
  });
});
