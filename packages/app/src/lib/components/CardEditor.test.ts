import { render } from "@testing-library/svelte";
import { afterEach, describe, it, expect, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import CardEditor from "./CardEditor.svelte";
import { settingsStore } from "#lib/settings.svelte.ts";
import type { EditEntry } from "#lib/types.ts";

const CONTENT = "first line\nsecond line";

function mountEditor(entry: EditEntry): EditorView {
  const { container } = render(CardEditor, {
    props: {
      content: CONTENT,
      entry,
      onSave: vi.fn(async () => true),
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
  });

  describe("with Vim disabled", () => {
    it("`start` places the caret before the first character", () => {
      expect(mountEditor("start").state.selection.main.head).toBe(0);
    });

    it("`end` places the caret after the last character", () => {
      expect(mountEditor("end").state.selection.main.head).toBe(CONTENT.length);
    });
  });
});
