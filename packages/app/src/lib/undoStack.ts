/** One undoable operation: a pair of inverse effects, not the data itself. */
export interface UndoEntry {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/**
 * In-memory command-pattern undo/redo stack (001-keybindings.md §4.4).
 * Session-scoped only — never persisted, and the caller clears it on deck
 * switch. Pushing a new entry drops the redo stack, matching standard
 * undo/redo semantics.
 */
export class UndoStack {
  private static readonly MAX_DEPTH = 100;

  private past: UndoEntry[] = [];
  private future: UndoEntry[] = [];

  push(entry: UndoEntry): void {
    this.past.push(entry);
    if (this.past.length > UndoStack.MAX_DEPTH) this.past.shift();
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  async undo(): Promise<boolean> {
    const entry = this.past.pop();
    if (!entry) return false;
    await entry.undo();
    this.future.push(entry);
    return true;
  }

  async redo(): Promise<boolean> {
    const entry = this.future.pop();
    if (!entry) return false;
    await entry.redo();
    this.past.push(entry);
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
