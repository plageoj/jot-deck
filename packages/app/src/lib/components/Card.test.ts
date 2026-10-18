import { fireEvent, render } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import Card from "./Card.svelte";
import { makeCard } from "#lib/__fixtures__/models.ts";
import type { EditSession } from "#lib/deckData.svelte.ts";

const openExternalUrl = vi.fn(async (_url: string) => {});
vi.mock("#lib/externalLinks.ts", () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

const CONTENT = "hello world";
const session: EditSession = {
  cardId: "card-1",
  owner: "owner-1",
  expectedUpdatedAt: "2026-01-01T00:00:00Z",
};

describe("Card editing", () => {
  it("opens the editor at the entry position and reports the cursor with the save", async () => {
    const onSave = vi.fn(
      async (_session: EditSession, _content: string, _release: boolean, _cursor: number) =>
        true,
    );
    const { container } = render(Card, {
      props: {
        card: makeCard("card-1", "col-1", { content: CONTENT }),
        editing: true,
        editSession: session,
        editEntry: "end",
        onSave,
      },
    });
    const dom = container.querySelector<HTMLElement>(".cm-editor");
    const view = dom && EditorView.findFromDOM(dom);
    if (!view) throw new Error("CodeMirror view was not mounted");

    expect(view.state.selection.main.head).toBe(CONTENT.length);

    await fireEvent.keyDown(view.contentDOM, { key: "Enter", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith(session, CONTENT, true, CONTENT.length);
  });
});

describe("Card link hints", () => {
  it("clicking a hint opens it and re-focuses the card without starting an edit", async () => {
    const onFocusCard = vi.fn();
    const onStartEdit = vi.fn();
    const { getByText } = render(Card, {
      props: {
        card: makeCard("card-1", "col-1", { content: "https://a.example https://b.example" }),
        focused: true,
        linkHints: ["https://a.example", "https://b.example"],
        onFocusCard,
        onStartEdit,
      },
    });

    await fireEvent.click(getByText("2"));

    expect(openExternalUrl).toHaveBeenCalledWith("https://b.example");
    expect(onFocusCard).toHaveBeenCalledOnce();
    expect(onStartEdit).not.toHaveBeenCalled();
  });
});
