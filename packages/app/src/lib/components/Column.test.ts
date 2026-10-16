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
