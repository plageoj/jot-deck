import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  SETTINGS_STORAGE_KEY,
  SettingsStore,
} from "./settings.svelte";

describe("SettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to DEFAULT_SETTINGS when storage is empty", () => {
    const store = new SettingsStore();
    store.load();
    expect(store.state).toEqual(DEFAULT_SETTINGS);
  });

  it("persists updates to localStorage", () => {
    const store = new SettingsStore();
    store.load();
    store.update("theme", "light");
    store.update("fontSize", 18);
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.theme).toBe("light");
    expect(parsed.fontSize).toBe(18);
  });

  it("rehydrates persisted settings", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, vimEnabled: false, theme: "dark" }),
    );
    const store = new SettingsStore();
    store.load();
    expect(store.state.vimEnabled).toBe(false);
    expect(store.state.theme).toBe("dark");
  });

  it("clamps out-of-range numeric values", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        fontSize: 999,
        lineHeight: -1,
      }),
    );
    const store = new SettingsStore();
    store.load();
    expect(store.state.fontSize).toBe(FONT_SIZE_MAX);
    expect(store.state.lineHeight).toBe(LINE_HEIGHT_MIN);
  });

  it("falls back to defaults for invalid theme values", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: "neon" }),
    );
    const store = new SettingsStore();
    store.load();
    expect(store.state.theme).toBe("auto");
  });

  it("reset() restores defaults and persists", () => {
    const store = new SettingsStore();
    store.load();
    store.update("theme", "light");
    store.reset();
    expect(store.state).toEqual(DEFAULT_SETTINGS);
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(JSON.parse(raw!).theme).toBe("auto");
  });

  it("respects FONT_SIZE_MIN as a sane lower bound", () => {
    expect(FONT_SIZE_MIN).toBeLessThan(FONT_SIZE_MAX);
    expect(LINE_HEIGHT_MIN).toBeLessThan(LINE_HEIGHT_MAX);
  });
});
