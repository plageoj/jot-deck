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

/** The desktop-only note right after `key`'s keycap in that row, if any. */
function noteAfter(description: string, key: string): string | null {
  const row = screen.getAllByText(description)[0].closest(".cheatsheet-item");
  const kbd = Array.from(row?.querySelectorAll("kbd") ?? []).find(
    (k) => k.textContent === key,
  );
  const next = kbd?.nextElementSibling;
  return next?.classList.contains("desktop-only") ? next.textContent : null;
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
    expect(noteAfter("Command palette", "Ctrl+Shift+P")).toBe("Desktop only");
    expect(noteAfter("Command palette", "F1")).toBeNull();
    expect(noteAfter("Switch column", "Ctrl+t")).toBe("Desktop only");
    expect(noteAfter("Switch column", "gn")).toBeNull();
    expect(noteAfter("Switch column", "gc")).toBeNull();
    expect(noteAfter("Switch deck", "Ctrl+p")).toBeNull();
  });
});

describe("KeybindingCheatsheet key labels", () => {
  it("shows arrows and Enter as symbols, with the key name on hover", () => {
    mockEnv.tauri = true;
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(keysFor("Move to left column")).toEqual(["h", "←"]);
    expect(keysFor("Focus first card")).toEqual(["j", "↓", "⏎"]);
    expect(screen.getAllByTitle("ArrowLeft")[0].textContent).toBe("←");
  });
});

describe("KeybindingCheatsheet in the desktop app", () => {
  beforeEach(() => {
    mockEnv.tauri = true;
  });

  it("keeps the declared order without notes", () => {
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(keysFor("Command palette")).toEqual(["Ctrl+Shift+P", "F1"]);
    expect(noteAfter("Command palette", "Ctrl+Shift+P")).toBeNull();
  });
});
