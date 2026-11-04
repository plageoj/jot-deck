import { render, screen } from "@testing-library/svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette.svelte";
import { setKeybindingOverrides } from "#lib/keybindings.ts";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  Element.prototype.scrollIntoView = () => {};
});

vi.mock("#lib/db/index.ts", () => ({
  getDatabase: () => Promise.reject(new Error("no db in tests")),
  isTauri: () => false,
}));

/** The shortcut shown beside the command labelled `label`, or null. */
function shortcutOf(label: string): string | null {
  const row = screen.getByText(label).closest(".palette-item");
  return row?.querySelector(".palette-shortcut")?.textContent ?? null;
}

describe("CommandPalette shortcuts", () => {
  afterEach(() => setKeybindingOverrides({}));

  it("shows the keys bound in the focus the palette returns to", () => {
    render(CommandPalette, { mode: "card", onExecute: () => {}, onClose: () => {} });
    expect(shortcutOf("Rename Deck")).toBe("R");
    // `dd` deletes the card in card focus, so Delete Column shows no key there.
    expect(shortcutOf("Delete Column")).toBeNull();
    expect(shortcutOf("Keyboard Shortcuts")).toBe("?");
  });

  it("ignores a binding that only works in another focus", () => {
    setKeybindingOverrides({}, [
      { sequence: "z", action: "renameDeck", modes: ["card"], description: "Rename deck" },
    ]);
    render(CommandPalette, { mode: "column", onExecute: () => {}, onClose: () => {} });
    expect(shortcutOf("Rename Deck")).toBe("R");
    expect(shortcutOf("Delete Column")).toBe("dd");
  });
});
