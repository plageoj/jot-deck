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
});
