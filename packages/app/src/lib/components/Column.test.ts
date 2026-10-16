import { fireEvent, render } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import Column from "./Column.svelte";
import type { Column as ColumnModel } from "#lib/types.ts";

const column: ColumnModel = {
  id: "col-1",
  deck_id: "deck-1",
  name: "Inbox",
  position: 0,
  description: null,
  private: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

function renderColumn(columnNumber?: number) {
  const { container } = render(Column, {
    props: { column, columnNumber, cards: [] },
  });
  return container.querySelector<HTMLElement>("kbd.column-number");
}

describe("Column number badge", () => {
  it.each([1, 9])("shows the g-jump hint for column %i", (n) => {
    const badge = renderColumn(n);
    expect(badge?.textContent).toBe(String(n));
    expect(badge?.title).toBe(`g ${n}: Focus this column`);
  });

  it("hides the badge from column 10 on, since there is no g-jump for it", () => {
    expect(renderColumn(10)).toBeNull();
  });

  it("hides the badge when no column number is given", () => {
    expect(renderColumn()).toBeNull();
  });
});

describe("Column header double-click", () => {
  function renderWithRename() {
    const onRenameColumn = vi.fn();
    const { container } = render(Column, {
      props: { column, cards: [], onAddCard: () => {}, onRenameColumn },
    });
    return { container, onRenameColumn };
  }

  it("opens rename when the header is double-clicked", async () => {
    const { container, onRenameColumn } = renderWithRename();
    await fireEvent.dblClick(container.querySelector(".column-name")!);
    expect(onRenameColumn).toHaveBeenCalledOnce();
  });

  it("ignores double-clicks on the add-card button", async () => {
    const { container, onRenameColumn } = renderWithRename();
    await fireEvent.dblClick(container.querySelector(".add-card")!);
    expect(onRenameColumn).not.toHaveBeenCalled();
  });

  it("ignores double-clicks outside the header", async () => {
    const { container, onRenameColumn } = renderWithRename();
    await fireEvent.dblClick(container.querySelector(".cards")!);
    expect(onRenameColumn).not.toHaveBeenCalled();
  });
});

describe("Column in-place rename", () => {
  function renderRenaming(renameDraft: string | null = "Inbox") {
    const callbacks = {
      onRenameColumn: vi.fn(),
      onRenameDraftChange: vi.fn(),
      onCommitRename: vi.fn(),
      onCancelRename: vi.fn(),
    };
    const { container } = render(Column, {
      props: { column, cards: [], renameDraft, renameFocusRequest: 1, ...callbacks },
    });
    const input = container.querySelector<HTMLInputElement>("input.column-name-input");
    return { container, input, ...callbacks };
  }

  it("shows the name as text when not renaming", () => {
    const { container, input } = renderRenaming(null);
    expect(input).toBeNull();
    expect(container.querySelector(".column-name")?.textContent).toBe("Inbox");
  });

  it("opens a focused input with the whole name selected", () => {
    const { input } = renderRenaming();
    expect(input?.value).toBe("Inbox");
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe("Inbox".length);
  });

  it("reports typed text as the draft", async () => {
    const { input, onRenameDraftChange } = renderRenaming();
    await fireEvent.input(input!, { target: { value: "Later" } });
    expect(onRenameDraftChange).toHaveBeenCalledWith("Later");
  });

  it("commits on Enter and cancels on Escape", async () => {
    const { input, onCommitRename, onCancelRename } = renderRenaming();
    await fireEvent.keyDown(input!, { key: "Enter" });
    expect(onCommitRename).toHaveBeenCalledOnce();
    await fireEvent.keyDown(input!, { key: "Escape" });
    expect(onCancelRename).toHaveBeenCalledOnce();
  });

  it("does not commit on the Enter that confirms an IME composition", async () => {
    const { input, onCommitRename } = renderRenaming();
    await fireEvent.keyDown(input!, { key: "Enter", isComposing: true });
    await fireEvent.keyDown(input!, { key: "Enter", keyCode: 229 });
    expect(onCommitRename).not.toHaveBeenCalled();
  });

  it("keeps the input open without committing when it loses focus", async () => {
    const { container, input, onCommitRename, onCancelRename } = renderRenaming();
    await fireEvent.blur(input!);
    expect(container.querySelector("input.column-name-input")).toBe(input);
    expect(onCommitRename).not.toHaveBeenCalled();
    expect(onCancelRename).not.toHaveBeenCalled();
  });

  it("does not restart the rename on double-clicks inside the input", async () => {
    const { input, onRenameColumn } = renderRenaming();
    await fireEvent.dblClick(input!);
    expect(onRenameColumn).not.toHaveBeenCalled();
  });
});
