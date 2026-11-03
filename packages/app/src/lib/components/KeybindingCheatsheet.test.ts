import { render, screen } from "@testing-library/svelte";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import KeybindingCheatsheet from "./KeybindingCheatsheet.svelte";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
});

const mockEnv = { tauri: false };
vi.mock("#lib/db/index.ts", () => ({ isTauri: () => mockEnv.tauri }));

/** The key labels of the row describing `description`, in display order. */
function keysFor(description: string): string[] {
  const row = screen.getAllByText(description)[0].closest(".cheatsheet-item");
  return Array.from(row?.querySelectorAll("kbd") ?? []).map((k) => k.textContent ?? "");
}

function noteFor(description: string): string | null {
  const row = screen.getAllByText(description)[0].closest(".cheatsheet-item");
  return row?.querySelector(".desktop-only")?.textContent ?? null;
}

describe("KeybindingCheatsheet in a browser", () => {
  beforeEach(() => {
    mockEnv.tauri = false;
  });

  it("lists working alternatives before browser-reserved keys", () => {
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(keysFor("Command palette")).toEqual(["F1", "Ctrl+Shift+P"]);
    expect(keysFor("Switch column")).toEqual(["gn", "gc", "Ctrl+t"]);
  });

  it("marks browser-reserved keys as desktop only", () => {
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(noteFor("Command palette")).toBe("Desktop only");
    expect(noteFor("Switch column")).toBe("Desktop only");
    expect(noteFor("Switch deck")).toBeNull();
  });
});

describe("KeybindingCheatsheet in the desktop app", () => {
  beforeEach(() => {
    mockEnv.tauri = true;
  });

  it("keeps the declared order without notes", () => {
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(keysFor("Command palette")).toEqual(["Ctrl+Shift+P", "F1"]);
    expect(noteFor("Command palette")).toBeNull();
  });
});
