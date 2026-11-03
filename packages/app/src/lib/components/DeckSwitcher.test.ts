import { render, screen } from "@testing-library/svelte";
import { beforeAll, describe, expect, it, vi } from "vitest";
import DeckSwitcher from "./DeckSwitcher.svelte";
import type { Deck } from "#lib/types.ts";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  // jsdom has no layout; PaletteDialog scrolls the selected row into view.
  Element.prototype.scrollIntoView = function () {};
});

const mockEnv = { tauri: false };
vi.mock("#lib/db/index.ts", () => ({ isTauri: () => mockEnv.tauri }));

const DECK: Deck = {
  id: "01DECK",
  name: "Getting Started",
  sort_order: "a0",
  created_at: "",
  updated_at: "",
};

function renderSwitcher() {
  render(DeckSwitcher, {
    props: {
      currentDeck: DECK,
      decks: [DECK],
      columnCount: 3,
      cardCount: 5,
      onSelect: vi.fn(),
      onNew: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      getMcpConfig: vi.fn(async () => "{}"),
      onClose: vi.fn(),
    },
  });
}

describe("DeckSwitcher MCP actions", () => {
  it("offers the MCP config and deck id copies in the desktop app", () => {
    mockEnv.tauri = true;
    renderSwitcher();
    expect(screen.getByRole("button", { name: "Copy MCP server config" })).toBeTruthy();
    expect(screen.getByText("Deck id")).toBeTruthy();
  });

  it("hides both copies in a browser, where no MCP bridge can reach the deck", () => {
    mockEnv.tauri = false;
    renderSwitcher();
    expect(screen.queryByRole("button", { name: "Copy MCP server config" })).toBeNull();
    expect(screen.queryByText("Deck id")).toBeNull();
    expect(screen.getByText("Getting Started", { selector: ".current-name" })).toBeTruthy();
  });
});
