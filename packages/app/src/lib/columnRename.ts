import type { Column } from "./types";

/** A column being renamed in place in its header. */
export interface ColumnRename {
  /** Deck the column belongs to, so the draft can still be saved after a
   * deck switch has replaced the board's columns. */
  deckId: string;
  columnId: string;
  originalName: string;
  draft: string;
  /** Bumped on each rename request so the input takes focus again. */
  focusRequest: number;
}

/**
 * The name to save when `rename` is committed, or `null` when there is
 * nothing to save: the draft is blank or unchanged, or the column has left
 * the current deck. A rename from another deck is still saved — the deck
 * switch that hid its input does not discard it.
 */
export function columnRenameToCommit(
  rename: ColumnRename,
  currentDeckId: string | null,
  columns: readonly Column[],
): string | null {
  const name = rename.draft.trim();
  if (!name || name === rename.originalName) return null;
  if (rename.deckId === currentDeckId && !columns.some((c) => c.id === rename.columnId)) {
    return null;
  }
  return name;
}
