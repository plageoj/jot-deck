import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DeckData } from "#lib/deckData.svelte.ts";
import type { FocusManager } from "#lib/focusManager.svelte.ts";
import { makeCard, makeColumn } from "./__fixtures__/models";
import { setupBoard } from "./__fixtures__/boardHarness";

// Opening links from a focused card with `x`: a single link opens at once,
// several enter link hint mode where a digit picks one.

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/boardBackend");
  return { getDatabase: async () => mockBackend };
});

const openExternalUrl = vi.fn(async (_url: string) => {});
vi.mock("./externalLinks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./externalLinks")>()),
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

const { ActionDispatcher } = await import("./actionDispatcher.svelte");

async function flushPromises() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function press(dispatcher: InstanceType<typeof ActionDispatcher>, key: string) {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  Object.defineProperty(event, "target", { value: document.body });
  dispatcher.handleKeydown(event);
  return event;
}

describe("opening card links", () => {
  let data: DeckData;
  let focus: FocusManager;
  let dispatcher: InstanceType<typeof ActionDispatcher>;

  beforeEach(async () => {
    openExternalUrl.mockClear();
    ({ data, focus } = await setupBoard({
      columns: [makeColumn("col-0", "deck-1", { position: 0 })],
      cards: {
        "col-0": [
          makeCard("one", "col-0", { content: "read https://one.example" }),
          makeCard("many", "col-0", {
            content: "[a](https://a.example) and https://b.example",
          }),
          makeCard("none", "col-0", { content: "no links here" }),
        ],
      },
    }));
    focus.focusMode = "card";
    focus.focusedColumnIndex = 0;
    dispatcher = new ActionDispatcher(data, focus);
  });

  async function showHintsOnManyCard() {
    focus.focusedCardIndex = 1;
    press(dispatcher, "x");
    await flushPromises();
  }

  it("x opens the only link immediately", async () => {
    focus.focusedCardIndex = 0;
    press(dispatcher, "x");
    await flushPromises();
    expect(openExternalUrl).toHaveBeenCalledWith("https://one.example");
    expect(focus.linkHints).toBeNull();
  });

  it("x does nothing on a card without links", async () => {
    focus.focusedCardIndex = 2;
    press(dispatcher, "x");
    await flushPromises();
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(focus.linkHints).toBeNull();
  });

  it("x shows numbered hints when the card has several links", async () => {
    await showHintsOnManyCard();
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(focus.linkHints).toEqual({
      cardId: "many",
      links: ["https://a.example", "https://b.example"],
    });
  });

  it("a digit opens the matching hint and leaves hint mode", async () => {
    await showHintsOnManyCard();
    const event = press(dispatcher, "2");
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith("https://b.example");
    expect(focus.linkHints).toBeNull();
  });

  it("any other key dismisses the hints without acting on the board", async () => {
    await showHintsOnManyCard();
    press(dispatcher, "j");
    await flushPromises();
    expect(focus.linkHints).toBeNull();
    expect(focus.focusedCardIndex).toBe(1);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("a digit beyond the hint count just dismisses", async () => {
    await showHintsOnManyCard();
    press(dispatcher, "5");
    await flushPromises();
    expect(focus.linkHints).toBeNull();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("stale hints from another card are dropped and the key runs normally", async () => {
    await showHintsOnManyCard();
    focus.focusedCardIndex = 0; // e.g. focus moved by mouse
    press(dispatcher, "j");
    await flushPromises();
    expect(focus.linkHints).toBeNull();
    expect(focus.focusedCardIndex).toBe(1);
  });

  it("starting an edit clears the hints", async () => {
    await showHintsOnManyCard();
    focus.startEdit("many");
    expect(focus.linkHints).toBeNull();
  });
});
