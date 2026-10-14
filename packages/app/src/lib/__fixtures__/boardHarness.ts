import type { Card, Column, Deck } from "#lib/types.ts";
import { DeckData } from "#lib/deckData.svelte.ts";
import { FocusManager } from "#lib/focusManager.svelte.ts";
import { BoardActionExecutors } from "#lib/boardActionExecutors.ts";
import { boardState, resetBoardState } from "./boardBackend";
import { makeDeck } from "./models";

/**
 * Builds a loaded DeckData + FocusManager over the fake board backend.
 * Requires the test file to mock `#lib/db/index.ts` with `boardBackend`.
 */
export async function setupBoard(
  options: {
    decks?: Deck[];
    columns?: Column[];
    cards?: Record<string, Card[]>;
  } = {},
): Promise<{ data: DeckData; focus: FocusManager }> {
  resetBoardState();
  boardState.decks = options.decks ?? [makeDeck("deck-1")];
  boardState.columns = options.columns ?? [];
  boardState.cardsByColumn = new Map(Object.entries(options.cards ?? {}));

  const data = new DeckData();
  await data.init();
  data.currentDeck = boardState.decks[0];
  data.columns = [...boardState.columns];
  data.cardsByColumn = Object.fromEntries(boardState.cardsByColumn);

  return { data, focus: new FocusManager(data) };
}

/**
 * Builds BoardActionExecutors with the same focus context ActionDispatcher
 * provides: the focused column/card is read from current state on each call.
 */
export function createBoardActions(
  data: DeckData,
  focus: FocusManager,
  callbacks: {
    startEdit?: (cardId: string) => void | Promise<void>;
    renameColumn?: () => void;
    runTask?: (task: Promise<unknown>) => void;
  } = {},
): BoardActionExecutors {
  return new BoardActionExecutors(() => {
    const focusedColumn: Column | undefined = data.columns[focus.focusedColumnIndex];
    const focusedCards = data.cardsByColumn[focusedColumn?.id ?? ""] ?? [];
    return {
      data,
      focus,
      focusedColumn,
      focusedCards,
      focusedCard: focusedCards[focus.focusedCardIndex],
      startEdit: callbacks.startEdit ?? null,
      renameColumn: callbacks.renameColumn ?? null,
      runTask:
        callbacks.runTask ??
        ((task) => {
          void task.catch((error) => {
            data.error = `Failed to execute action: ${error}`;
          });
        }),
    };
  });
}
