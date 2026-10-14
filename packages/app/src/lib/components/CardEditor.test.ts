import { fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, it, expect, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import CardEditor from "./CardEditor.svelte";
import { settingsStore } from "#lib/settings.svelte.ts";
import type { EditEntry } from "#lib/types.ts";

const CONTENT = "first line\nsecond line";
/** End of the first line — Normal mode would clamp this onto the "e". */
const FIRST_LINE_END = "first line".length;

function mountEditor(
  entry: EditEntry,
  onSave = vi.fn(async (_content: string, _release: boolean, _cursor: number) => true),
): EditorView {
  const { container } = render(CardEditor, {
    props: {
      content: CONTENT,
      entry,
      onSave,
      onCancel: vi.fn(async () => true),
    },
  });
  const dom = container.querySelector<HTMLElement>(".cm-editor");
  const view = dom && EditorView.findFromDOM(dom);
  if (!view) throw new Error("CodeMirror view was not mounted");
  return view;
}

afterEach(() => {
  settingsStore.state.vimEnabled = false;
});

describe("CardEditor entry position", () => {
  describe("with Vim enabled", () => {
    it("`start` lands in Insert mode before the first character", () => {
      settingsStore.state.vimEnabled = true;
      const view = mountEditor("start");

      expect(view.state.selection.main.head).toBe(0);
      expect(getCM(view)?.state.vim?.insertMode).toBe(true);
    });

    it("`end` lands in Insert mode after the last character", () => {
      settingsStore.state.vimEnabled = true;
      const view = mountEditor("end");

      expect(view.state.selection.main.head).toBe(CONTENT.length);
      expect(getCM(view)?.state.vim?.insertMode).toBe(true);
    });

    it("a remembered offset at a line end survives Normal mode's clamp", () => {
      settingsStore.state.vimEnabled = true;
      const view = mountEditor(FIRST_LINE_END);

      expect(view.state.selection.main.head).toBe(FIRST_LINE_END);
      expect(getCM(view)?.state.vim?.insertMode).toBe(true);
    });
  });

  describe("with Vim disabled", () => {
    it("`start` places the caret before the first character", () => {
      expect(mountEditor("start").state.selection.main.head).toBe(0);
    });

    it("`end` places the caret after the last character", () => {
      expect(mountEditor("end").state.selection.main.head).toBe(CONTENT.length);
    });

    it("a remembered offset is clamped to the content", () => {
      expect(mountEditor(999).state.selection.main.head).toBe(CONTENT.length);
    });
  });

  it("reports the cursor offset when saving", async () => {
    const onSave = vi.fn(async (_content: string, _release: boolean, _cursor: number) => true);
    const view = mountEditor(FIRST_LINE_END, onSave);

    await fireEvent.keyDown(view.contentDOM, { key: "Enter", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith(CONTENT, true, FIRST_LINE_END);
  });
});
