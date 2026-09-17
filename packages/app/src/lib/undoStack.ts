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
  // Bumped by clear() so a mutation that started before a deck switch (and
  // resolves after) can tell its captured generation is stale and skip
  // pushing into the new deck's history. Also used by undo()/redo() to avoid
  // repopulating a stack that was cleared out from under an in-flight effect.
  private generation = 0;
  // Serializes undo()/redo(): an effect's DB work + reload is not atomic, so
  // a second call arriving before the first resolves would race the same
  // shared state. A no-op false return (rather than queuing) is enough since
  // callers already await before allowing another keypress to dispatch.
  private busy = false;

  /** Snapshot to pass to a later `push()` call, captured before starting an
   * async mutation — so the push can be skipped if `clear()` ran meanwhile. */
  get currentGeneration(): number {
    return this.generation;
  }

  push(entry: UndoEntry, generation?: number): void {
    if (generation !== undefined && generation !== this.generation) return;
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
    if (this.busy) return false;
    const entry = this.past.pop();
    if (!entry) return false;
    this.busy = true;
    const generation = this.generation;
    try {
      await entry.undo();
      if (this.generation === generation) this.future.push(entry);
      return true;
    } catch (e) {
      if (this.generation === generation) this.past.push(entry);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  async redo(): Promise<boolean> {
    if (this.busy) return false;
    const entry = this.future.pop();
    if (!entry) return false;
    this.busy = true;
    const generation = this.generation;
    try {
      await entry.redo();
      if (this.generation === generation) this.past.push(entry);
      return true;
    } catch (e) {
      if (this.generation === generation) this.future.push(entry);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.generation++;
  }
}
