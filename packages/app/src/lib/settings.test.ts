import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  SETTINGS_DB_KEY,
  SettingsStore,
  deserializeSettings,
} from "./settings.svelte";
import type { DatabaseBackend } from "./db";

/**
 * Minimal in-memory backend stub. Only the settings methods are exercised by
 * the SettingsStore — the rest throw to fail loudly if accidentally invoked.
 */
function makeBackend(): {
  backend: DatabaseBackend;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const reject = () => {
    throw new Error("not implemented in stub");
  };
  const backend = {
    getAllDecks: reject,
    getDeck: reject,
    createDeck: reject,
    updateDeck: reject,
    deleteDeck: reject,
    getColumnsByDeck: reject,
    getColumn: reject,
    createColumn: reject,
    updateColumn: reject,
    moveColumn: reject,
    deleteColumn: reject,
    restoreColumn: reject,
    getDeletedColumns: reject,
    getCardsByColumn: reject,
    getCard: reject,
    createCard: reject,
    updateCardContent: reject,
    updateCardScore: reject,
    moveCardToColumn: reject,
    moveCard: reject,
    deleteCard: reject,
    restoreCard: reject,
    getDeletedCards: reject,
    getTagsByDeck: reject,
    getCardsByTag: reject,
    getTagSuggestions: reject,
    async getSettings(key: string) {
      return store.get(key) ?? null;
    },
    async setSettings(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as DatabaseBackend;

  return { backend, store };
}

describe("deserializeSettings", () => {
  it("returns defaults for null", () => {
    expect(deserializeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for malformed JSON", () => {
    expect(deserializeSettings("not json")).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps out-of-range numerics", () => {
    const raw = JSON.stringify({ fontSize: 999, lineHeight: -1 });
    const result = deserializeSettings(raw);
    expect(result.fontSize).toBe(FONT_SIZE_MAX);
    expect(result.lineHeight).toBe(LINE_HEIGHT_MIN);
  });

  it("falls back to auto for unknown theme values", () => {
    expect(deserializeSettings(JSON.stringify({ theme: "neon" })).theme).toBe(
      "auto",
    );
  });

  it("defaults keybindingOverrides to an empty object", () => {
    expect(deserializeSettings(null).keybindingOverrides).toEqual({});
    expect(
      deserializeSettings(JSON.stringify({ keybindingOverrides: "nope" }))
        .keybindingOverrides,
    ).toEqual({});
  });

  it("keeps only string|null keybinding override values", () => {
    const raw = JSON.stringify({
      keybindingOverrides: { a: "x", b: null, c: 42, d: { nested: true } },
    });
    expect(deserializeSettings(raw).keybindingOverrides).toEqual({
      a: "x",
      b: null,
    });
  });

  it("defaults customKeybindings to an empty array", () => {
    expect(deserializeSettings(null).customKeybindings).toEqual([]);
    expect(
      deserializeSettings(JSON.stringify({ customKeybindings: "nope" }))
        .customKeybindings,
    ).toEqual([]);
  });

  it("drops malformed custom keybindings and keeps well-formed ones", () => {
    const raw = JSON.stringify({
      customKeybindings: [
        { sequence: "z", action: "undo", modes: ["card"], description: "Undo" },
        { sequence: "", action: "undo", modes: ["card"] }, // empty sequence
        { sequence: "q", action: "undo", modes: ["bogus"] }, // no valid modes
        { sequence: "w", modes: ["card"] }, // missing action
        "not an object",
      ],
    });
    const result = deserializeSettings(raw).customKeybindings;
    expect(result).toEqual([
      { sequence: "z", action: "undo", modes: ["card"], description: "Undo" },
    ]);
  });

  it("falls back description to the action when omitted", () => {
    const raw = JSON.stringify({
      customKeybindings: [{ sequence: "z", action: "undo", modes: ["card"] }],
    });
    expect(deserializeSettings(raw).customKeybindings[0].description).toBe(
      "undo",
    );
  });
});

describe("SettingsStore (DB-backed)", () => {
  let stub: ReturnType<typeof makeBackend>;
  let store: SettingsStore;

  beforeEach(() => {
    stub = makeBackend();
    store = new SettingsStore(async () => stub.backend);
  });

  it("hydrates defaults when nothing is persisted", async () => {
    await store.load();
    expect(store.state).toEqual(DEFAULT_SETTINGS);
    expect(store.loaded).toBe(true);
  });

  it("persists updates to the backend under SETTINGS_DB_KEY", async () => {
    await store.load();
    store.update("theme", "light");
    store.update("fontSize", 18);
    await store.persist();

    const raw = stub.store.get(SETTINGS_DB_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.theme).toBe("light");
    expect(parsed.fontSize).toBe(18);
  });

  it("rehydrates state from the backend", async () => {
    stub.store.set(
      SETTINGS_DB_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: "dark", vimEnabled: false }),
    );
    await store.load();
    expect(store.state.theme).toBe("dark");
    expect(store.state.vimEnabled).toBe(false);
  });

  it("reset() restores defaults and persists them", async () => {
    await store.load();
    store.update("theme", "light");
    await store.persist();
    store.reset();
    await store.persist();

    expect(store.state).toEqual(DEFAULT_SETTINGS);
    const parsed = JSON.parse(stub.store.get(SETTINGS_DB_KEY)!);
    expect(parsed.theme).toBe("auto");
  });

  it("falls back to defaults if the backend rejects", async () => {
    const broken = new SettingsStore(async () => {
      throw new Error("offline");
    });
    await broken.load();
    expect(broken.state).toEqual(DEFAULT_SETTINGS);
    expect(broken.loaded).toBe(true);
  });

  it("sets and persists a keybinding override", async () => {
    await store.load();
    store.setKeybindingOverride("sig-1", "x");
    await store.persist();

    expect(store.state.keybindingOverrides).toEqual({ "sig-1": "x" });
    const parsed = JSON.parse(stub.store.get(SETTINGS_DB_KEY)!);
    expect(parsed.keybindingOverrides).toEqual({ "sig-1": "x" });
  });

  it("clears several overrides at once (single binding or per-command reset)", async () => {
    await store.load();
    store.setKeybindingOverride("sig-1", "x");
    store.setKeybindingOverride("sig-2", null);
    store.setKeybindingOverride("sig-3", "y");
    store.clearKeybindingOverrides(["sig-1", "sig-2", "missing"]);

    expect(store.state.keybindingOverrides).toEqual({ "sig-3": "y" });
  });

  it("adds, updates, and removes custom keybindings", async () => {
    await store.load();
    store.addCustomKeybinding({
      sequence: "z",
      action: "undo",
      modes: ["card"],
      description: "Undo",
    });
    expect(store.state.customKeybindings).toHaveLength(1);

    store.updateCustomKeybinding(0, {
      ...store.state.customKeybindings[0],
      sequence: "Z",
    });
    expect(store.state.customKeybindings[0].sequence).toBe("Z");

    store.removeCustomKeybinding(0);
    expect(store.state.customKeybindings).toEqual([]);
  });

  it("persists custom keybindings", async () => {
    await store.load();
    store.addCustomKeybinding({
      sequence: "z",
      action: "undo",
      modes: ["card"],
      description: "Undo",
    });
    await store.persist();
    const parsed = JSON.parse(stub.store.get(SETTINGS_DB_KEY)!);
    expect(parsed.customKeybindings).toHaveLength(1);
    expect(parsed.customKeybindings[0].sequence).toBe("z");
  });

  it("resetAllKeybindings clears overrides and custom bindings", async () => {
    await store.load();
    store.update("theme", "dark");
    store.setKeybindingOverride("sig-1", "x");
    store.addCustomKeybinding({
      sequence: "z",
      action: "undo",
      modes: ["card"],
      description: "Undo",
    });
    store.resetAllKeybindings();

    expect(store.state.keybindingOverrides).toEqual({});
    expect(store.state.customKeybindings).toEqual([]);
    expect(store.state.theme).toBe("dark"); // unrelated settings untouched
  });
});
