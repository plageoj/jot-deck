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
  return Array.from(row?.querySelectorAll("dt kbd") ?? []).map((k) => k.textContent ?? "");
}

/** The keys of that row shown dimmed as unavailable in the browser. */
function unavailableKeys(description: string): string[] {
  const row = screen.getAllByText(description)[0].closest(".cheatsheet-item");
  return Array.from(row?.querySelectorAll("dt kbd.unavailable") ?? []).map(
    (k) => k.textContent ?? "",
  );
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

  it("dims browser-reserved keys and labels them desktop only", () => {
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(unavailableKeys("Command palette")).toEqual(["Ctrl+Shift+P"]);
    expect(unavailableKeys("Switch column")).toEqual(["Ctrl+t"]);
    expect(unavailableKeys("Switch deck")).toEqual([]);
    expect(screen.getByTitle("Ctrl+t — Desktop only").textContent).toBe("Ctrl+t");
  });

  it("explains dimmed keys in a legend", () => {
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(screen.getByText("Desktop only")).toBeTruthy();
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

describe("KeybindingCheatsheet native shortcuts", () => {
  /** Row descriptions and their key labels within one rendered cheatsheet. */
  function rows(container: HTMLElement): Map<string, string[]> {
    return new Map(
      Array.from(container.querySelectorAll(".cheatsheet-item")).map((item) => [
        item.querySelector("dd")?.textContent ?? "",
        Array.from(item.querySelectorAll("dt kbd")).map((k) => k.textContent ?? ""),
      ]),
    );
  }

  it.each([true, false])("lists Ctrl+v paste in card mode (tauri: %s)", (tauri) => {
    mockEnv.tauri = tauri;
    const { container } = render(KeybindingCheatsheet, {
      props: { mode: "card", onClose: vi.fn() },
    });
    const shown = rows(container);
    expect(shown.get("Paste system clipboard text below")).toEqual(["Ctrl+v"]);
    expect(shown.get("Copy card text to system clipboard")).toEqual(["Ctrl+c"]);
    expect(shown.get("Cut card text to system clipboard")).toEqual(["Ctrl+x"]);
    // Reserved-only aliases are not listed, and the paste key is never dimmed.
    expect(container.textContent).not.toContain("Ctrl+Shift+V");
    expect(container.querySelector('kbd.unavailable[title^="Ctrl+v"]')).toBeNull();
  });

  it("does not list it in column mode", () => {
    mockEnv.tauri = true;
    const { container } = render(KeybindingCheatsheet, {
      props: { mode: "column", onClose: vi.fn() },
    });
    expect(rows(container).has("Paste system clipboard text below")).toBe(false);
  });
});

describe("KeybindingCheatsheet in the desktop app", () => {
  beforeEach(() => {
    mockEnv.tauri = true;
  });

  it("keeps the declared order without notes", () => {
    render(KeybindingCheatsheet, { props: { mode: "column", onClose: vi.fn() } });
    expect(keysFor("Command palette")).toEqual(["Ctrl+Shift+P", "F1"]);
    expect(unavailableKeys("Command palette")).toEqual([]);
    expect(screen.queryByText("Desktop only")).toBeNull();
  });
});
