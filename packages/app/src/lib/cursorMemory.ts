import type { EditEntry } from "./types";

interface RememberedCursor {
  offset: number;
  /** The card content the offset was recorded against. */
  content: string;
}

/**
 * Per-card cursor positions from the last saved edit, kept for the session
 * only. A position is reused only while the card content is exactly what it
 * was recorded against, so writes from elsewhere (MCP, Reporters, undo) can
 * never leave the cursor at a shifted offset.
 */
export class CursorMemory {
  private readonly cursors = new Map<string, RememberedCursor>();

  remember(cardId: string, offset: number, content: string) {
    this.cursors.set(cardId, { offset, content });
  }

  /** Resolve a `start` entry to the remembered offset when it is still valid. */
  resolve(cardId: string, entry: EditEntry, content: string | null): EditEntry {
    if (entry !== "start") return entry;
    const remembered = this.cursors.get(cardId);
    if (!remembered || remembered.content !== content) return entry;
    return remembered.offset;
  }
}
