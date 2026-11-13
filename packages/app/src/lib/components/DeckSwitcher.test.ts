import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

function renderSwitcher(getMcpConfig: () => Promise<string | null> = async () => "{}") {
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
      getMcpConfig,
      onClose: vi.fn(),
    },
  });
}

describe("DeckSwitcher copy actions", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockEnv.tauri = true;
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copies the generated MCP config snippet and confirms it", async () => {
    renderSwitcher(async () => '{"mcpServers":{}}');
    const button = screen.getByRole("button", { name: "Copy MCP server config" });
    await fireEvent.click(button);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('{"mcpServers":{}}'));
    await vi.waitFor(() => expect(button.getAttribute("title")).toBe("Copied!"));
  });

  it("falls back to the deck id when no config snippet is available", async () => {
    renderSwitcher(async () => null);
    await fireEvent.click(screen.getByRole("button", { name: "Copy MCP server config" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(DECK.id));
  });

  it("copies the deck id and confirms it", async () => {
    renderSwitcher();
    await fireEvent.click(screen.getByTitle("Copy deck id"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(DECK.id));
    await vi.waitFor(() => expect(screen.getByText("Copied!")).toBeTruthy());
  });

  it("shows no confirmation when the clipboard write fails", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderSwitcher();
    await fireEvent.click(screen.getByTitle("Copy deck id"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText("Copied!")).toBeNull();
  });
});

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
