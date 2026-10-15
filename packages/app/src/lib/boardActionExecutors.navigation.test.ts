import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DeckData } from "#lib/deckData.svelte.ts";
import type { FocusManager } from "#lib/focusManager.svelte.ts";
import type { BoardActionExecutors } from "#lib/boardActionExecutors.ts";
import { makeCard, makeColumn } from "./__fixtures__/models";
import { createBoardActions, setupBoard } from "./__fixtures__/boardHarness";

// Focus navigation executed by BoardActionExecutors: moving between columns
// and cards, entering/leaving card focus, and half-page scrolling.

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/boardBackend");
  return { getDatabase: async () => mockBackend };
});

describe("column-focus navigation", () => {
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

  it("moveLeft decrements focusedColumnIndex", async () => {
    await actions.executeColumnAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("moveLeft wraps from the first column to the last", async () => {
    focus.focusedColumnIndex = 0;
    await actions.executeColumnAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(2);
  });

  it("moveRight increments focusedColumnIndex", async () => {
    await actions.executeColumnAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(2);
  });

  it("moveRight wraps from the last column to the first", async () => {
    focus.focusedColumnIndex = 2;
    await actions.executeColumnAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("enterCardFocusFirst moves to first card and switches to card mode", async () => {
    await actions.executeColumnAction("enterCardFocusFirst");
    expect(focus.focusMode).toBe("card");
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("enterCardFocusFirst is a no-op for an empty column", async () => {
    focus.focusedColumnIndex = 2; // col-2 has no cards
    await actions.executeColumnAction("enterCardFocusFirst");
    expect(focus.focusMode).toBe("column");
  });

  it("enterCardFocusLast moves to last card and switches to card mode", async () => {
    focus.focusedColumnIndex = 0; // col-0 has 2 cards
    await actions.executeColumnAction("enterCardFocusLast");
    expect(focus.focusMode).toBe("card");
    expect(focus.focusedCardIndex).toBe(1);
  });
});

describe("card-focus navigation", () => {
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

  it.each([
    {
      name: "moveDown advances focusedCardIndex within the column",
      action: "moveDown",
      from: 1,
      expected: 2,
    },
    {
      name: "moveDown wraps from the last card to the first",
      action: "moveDown",
      from: 2,
      expected: 0,
    },
    {
      name: "moveUp decrements focusedCardIndex",
      action: "moveUp",
      from: 1,
      expected: 0,
    },
    {
      name: "moveUp wraps from the first card to the last",
      action: "moveUp",
      from: 0,
      expected: 2,
    },
    {
      name: "goFirst snaps focusedCardIndex to 0",
      action: "goFirst",
      from: 1,
      expected: 0,
    },
    {
      name: "goLast snaps focusedCardIndex to last card",
      action: "goLast",
      from: 1,
      expected: 2,
    },
  ])("$name", async ({ action, from, expected }) => {
    focus.focusedCardIndex = from;
    await actions.executeCardAction(action);
    expect(focus.focusedCardIndex).toBe(expected);
  });

  it("moveLeft is a no-op at the first column in card mode", async () => {
    await actions.executeCardAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(0);
  });

  it("moveRight switches columns and saves/restores card index", async () => {
    await actions.executeCardAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(1);
    // col-1 has 1 card → restoreCardIndex falls back to length-1 = 0
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("moveLeft navigates to the previous column and stays in card mode", async () => {
    focus.focusedColumnIndex = 1;
    focus.focusedCardIndex = 0;
    await actions.executeCardAction("moveLeft");
    expect(focus.focusedColumnIndex).toBe(0);
    expect(focus.focusMode).toBe("card"); // col-0 has cards
  });

  it("moveRight to an empty column drops to column mode", async () => {
    data.cardsByColumn = { ...data.cardsByColumn, "col-1": [] };
    focus.focusedCardIndex = 0;
    await actions.executeCardAction("moveRight");
    expect(focus.focusedColumnIndex).toBe(1);
    expect(focus.focusMode).toBe("column");
  });

  it("scrollHalfPageUp clamps to 0", async () => {
    await actions.executeCardAction("scrollHalfPageUp");
    expect(focus.focusedCardIndex).toBe(0);
  });

  it("scrollHalfPageDown clamps to last card", async () => {
    await actions.executeCardAction("scrollHalfPageDown");
    expect(focus.focusedCardIndex).toBe(2);
  });

  it("exitToColumn switches to column mode", async () => {
    await actions.executeCardAction("exitToColumn");
    expect(focus.focusMode).toBe("column");
  });
});
