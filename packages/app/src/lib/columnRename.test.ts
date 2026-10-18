import { describe, it, expect } from "vitest";
import { columnRenameToCommit, type ColumnRename } from "./columnRename";
import type { Column } from "./types";

function makeColumn(id: string, name: string): Column {
  return {
    id,
    deck_id: "deck-a",
    name,
    position: 0,
    description: null,
    private: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  };
}

function makeRename(draft: string): ColumnRename {
  return { deckId: "deck-a", columnId: "col-1", originalName: "Inbox", draft, focusRequest: 1 };
}

const deckAColumns = [makeColumn("col-1", "Inbox")];

describe("columnRenameToCommit", () => {
  it("returns the trimmed draft", () => {
    expect(columnRenameToCommit(makeRename("  Later  "), "deck-a", deckAColumns)).toBe("Later");
  });

  it.each(["", "   ", "Inbox", " Inbox "])("skips a blank or unchanged draft (%j)", (draft) => {
    expect(columnRenameToCommit(makeRename(draft), "deck-a", deckAColumns)).toBeNull();
  });

  it("skips a column no longer in the current deck", () => {
    expect(columnRenameToCommit(makeRename("Later"), "deck-a", [])).toBeNull();
  });

  it("still saves a draft from another deck after a deck switch", () => {
    const deckBColumns = [makeColumn("col-9", "Elsewhere")];
    expect(columnRenameToCommit(makeRename("Later"), "deck-b", deckBColumns)).toBe("Later");
  });
});
