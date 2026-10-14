import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DeckData } from "#lib/deckData.svelte.ts";
import type { FocusManager } from "#lib/focusManager.svelte.ts";
import { makeColumn } from "./__fixtures__/models";
import { setupBoard } from "./__fixtures__/boardHarness";
import { executeGlobalAction } from "./actionDispatchHelpers";

// Global (focus-mode independent) actions: palettes, dialogs, tag filter,
// deck reload, and undo/redo.

vi.mock("#lib/db/index.ts", async () => {
  const { mockBackend } = await import("./__fixtures__/boardBackend");
  return { getDatabase: async () => mockBackend };
});

describe("executeGlobalAction", () => {
  let data: DeckData;
  let focus: FocusManager;

  beforeEach(async () => {
    ({ data, focus } = await setupBoard());
  });

  it.each([
    ["showCommandPalette", "command"],
    ["showDeckPalette", "deck"],
    ["showColumnPalette", "column"],
    ["openTagFilter", "tag"],
    ["showTrashPalette", "trash"],
  ] as const)("%s opens the %s palette", async (action, palette) => {
    expect(await executeGlobalAction(action, data, focus)).toBe(true);
    expect(focus.activePalette).toBe(palette);
  });

  it.each(["showSettings", "showKeybindings", "showAbout", "showReporters"] as const)(
    "%s opens its dialog without a palette",
    async (action) => {
      expect(await executeGlobalAction(action, data, focus)).toBe(true);
      expect(focus[action]).toBe(true);
      expect(focus.activePalette).toBeNull();
      expect(focus.focusMode).not.toBe("command");
    },
  );

  it("clearTagFilter clears the active filter on data", async () => {
    data.activeTagFilter = "todo";
    await executeGlobalAction("clearTagFilter", data, focus);
    expect(data.activeTagFilter).toBeNull();
  });

  it("reloadDeck clamps focus only when the reload commits", async () => {
    const reload = vi.spyOn(data, "reloadDeck").mockResolvedValue(false);
    const clamp = vi.spyOn(focus, "clampToLoadedDeck");

    await executeGlobalAction("reloadDeck", data, focus);
    expect(clamp).not.toHaveBeenCalled();

    reload.mockResolvedValue(true);
    await executeGlobalAction("reloadDeck", data, focus);
    expect(clamp).toHaveBeenCalledOnce();
  });

  it("undo clamps a focus index left past the last column", async () => {
    data.columns = [
      makeColumn("col-0", "deck-1", { position: 0 }),
      makeColumn("col-1", "deck-1", { position: 1 }),
    ];
    focus.focusedColumnIndex = 1;
    data.history.push({
      undo: async () => {
        data.columns = data.columns.slice(0, 1);
      },
      redo: async () => {},
    });

    await executeGlobalAction("undo", data, focus);

    expect(focus.focusedColumnIndex).toBe(0);
  });

  it.each(["undo", "redo"] as const)(
    "%s reports a failure through the data error state and still clamps focus",
    async (action) => {
      vi.spyOn(data.history, action).mockRejectedValue(new Error("db gone"));
      const clamp = vi.spyOn(focus, "clampToCurrentDeck");

      expect(await executeGlobalAction(action, data, focus)).toBe(true);

      expect(data.error).toBe(`Failed to ${action}: Error: db gone`);
      expect(clamp).toHaveBeenCalledOnce();
    },
  );

  it("returns false for actions it does not own", () => {
    expect(executeGlobalAction("moveLeft", data, focus)).toBe(false);
  });
});
