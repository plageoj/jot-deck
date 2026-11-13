import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DeckData } from "#lib/deckData.svelte.ts";
import type { FocusManager } from "#lib/focusManager.svelte.ts";
import type { BoardActionExecutors } from "#lib/boardActionExecutors.ts";
import { threeColumnBoard } from "./__fixtures__/boards";
import { createBoardActions } from "./__fixtures__/boardHarness";

// New-card creation records where focus was beforehand, so a new card that is
// left empty and discarded hands focus back to the same place (#94).

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/boardBackend");
  return { getDatabase: async () => mockBackend };
});

describe("focus remembered before a new card", () => {
  let data: DeckData;
  let focus: FocusManager;
  let actions: BoardActionExecutors;
  let remember: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ({ data, focus } = await threeColumnBoard());
    focus.focusedColumnIndex = 0;
    actions = createBoardActions(data, focus, { startEdit: vi.fn() });
    remember = vi.spyOn(focus, "rememberFocusBeforeNewCard");
  });

  it("remembers column focus for `o` in column focus", async () => {
    focus.focusMode = "column";
    focus.focusedCardIndex = 1;
    await actions.executeColumnAction("createCard");

    expect(remember).toHaveBeenCalledTimes(1);
    const [cardId, mode, cardIndex] = remember.mock.calls[0];
    expect(mode).toBe("column");
    expect(cardIndex).toBe(1);
    expect(data.cardsByColumn["col-0"].some((card) => card.id === cardId)).toBe(true);
  });

  it.each([
    ["createCardBelow", "o"],
    ["createCardAbove", "O"],
  ] as const)("remembers card focus for %s (`%s`) in card focus", async (action, _key) => {
    focus.focusMode = "card";
    focus.focusedCardIndex = 1;
    await actions.executeCardAction(action);

    expect(remember).toHaveBeenCalledTimes(1);
    const [, mode, cardIndex] = remember.mock.calls[0];
    expect(mode).toBe("card");
    expect(cardIndex).toBe(1);
  });
});
