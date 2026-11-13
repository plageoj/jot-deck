import { makeCard, makeColumn } from "./models";
import { setupBoard } from "./boardHarness";

/**
 * Named boards shared by the BoardActionExecutors / ActionDispatcher tests.
 * Like `setupBoard`, these require the test file to mock `#lib/db/index.ts`
 * with `boardBackend`.
 */

/** Three columns: col-0 has two cards, col-1 one, col-2 is empty. */
export function threeColumnBoard() {
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

/** Two columns: col-0 has three cards, col-1 one. */
export function twoColumnBoard() {
  return setupBoard({
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
  });
}
