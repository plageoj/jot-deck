import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeKey, KeySequenceProcessor } from "./keyProcessor";
import {
  DEFAULT_KEYBINDINGS,
  setKeybindingOverrides,
  signatureOf,
} from "./keybindings";

function key(
  k: string,
  opts: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: k,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    metaKey: opts.meta ?? false,
  });
}

describe("normalizeKey", () => {
  it("returns null for modifier-only keys", () => {
    for (const k of ["Control", "Alt", "Shift", "Meta"]) {
      expect(normalizeKey(key(k))).toBeNull();
    }
  });

  it("leaves Cmd/Win combos to the OS instead of reading them as bare keys", () => {
    expect(normalizeKey(key("c", { meta: true }))).toBeNull();
    expect(normalizeKey(key("v", { meta: true }))).toBeNull();
    expect(normalizeKey(key("ArrowUp", { meta: true }))).toBeNull();
  });

  it("maps direct keys to their own token", () => {
    expect(normalizeKey(key("Escape"))).toBe("Escape");
    expect(normalizeKey(key("Enter"))).toBe("Enter");
    expect(normalizeKey(key("Delete"))).toBe("Delete");
    expect(normalizeKey(key("PageUp"))).toBe("PageUp");
    expect(normalizeKey(key("PageDown"))).toBe("PageDown");
  });

  it("recognizes function keys", () => {
    expect(normalizeKey(key("F1"))).toBe("F1");
    expect(normalizeKey(key("F12"))).toBe("F12");
  });

  it("treats F-prefixed non-numeric keys as unknown", () => {
    expect(normalizeKey(key("Fn"))).toBeNull();
  });

  it("prefixes arrow keys with active modifiers", () => {
    expect(normalizeKey(key("ArrowUp"))).toBe("ArrowUp");
    expect(normalizeKey(key("ArrowLeft", { ctrl: true }))).toBe("Ctrl+ArrowLeft");
    expect(normalizeKey(key("ArrowRight", { shift: true }))).toBe(
      "Shift+ArrowRight",
    );
    expect(normalizeKey(key("ArrowDown", { ctrl: true, shift: true }))).toBe(
      "Ctrl+Shift+ArrowDown",
    );
  });

  it("prefixes Ctrl (and Ctrl+Shift) for single-character keys", () => {
    expect(normalizeKey(key("p", { ctrl: true }))).toBe("Ctrl+p");
    expect(normalizeKey(key("P", { ctrl: true, shift: true }))).toBe(
      "Ctrl+Shift+P",
    );
  });

  it("returns single characters as-is", () => {
    expect(normalizeKey(key("a"))).toBe("a");
    expect(normalizeKey(key("?"))).toBe("?");
  });

  it("returns null for unhandled multi-character keys", () => {
    expect(normalizeKey(key("Tab"))).toBeNull();
    expect(normalizeKey(key("Home"))).toBeNull();
  });
});

describe("KeySequenceProcessor", () => {
  // Run against a fixed test table so changes to the default keymap (covered
  // in keybindings.test.ts) cannot break the sequencing logic tested here.
  beforeEach(() => {
    const disableDefaults = Object.fromEntries(
      DEFAULT_KEYBINDINGS.map((b) => [signatureOf(b), null]),
    );
    setKeybindingOverrides(disableDefaults, [
      { sequence: "j", action: "single", modes: ["column"], description: "" },
      { sequence: "dd", action: "double", modes: ["column"], description: "" },
    ]);
  });

  afterEach(() => setKeybindingOverrides({}));

  it("resolves an exact single-key binding to an action", () => {
    const p = new KeySequenceProcessor();
    expect(p.process("j", "column")).toEqual({ type: "action", action: "single" });
  });

  it("waits on a valid prefix then resolves the full sequence", () => {
    const p = new KeySequenceProcessor();
    expect(p.process("d", "column")).toEqual({ type: "prefix" });
    expect(p.process("d", "column")).toEqual({ type: "action", action: "double" });
  });

  it("falls back to the single key when the accumulated sequence fails", () => {
    const p = new KeySequenceProcessor();
    // "d" is a prefix; "dj" is not a binding, so it retries "j" alone.
    p.process("d", "column");
    expect(p.process("j", "column")).toEqual({ type: "action", action: "single" });
  });

  it("only matches bindings for the given mode", () => {
    const p = new KeySequenceProcessor();
    expect(p.process("j", "card")).toEqual({ type: "none" });
  });

  it("returns none for keys with no binding or prefix", () => {
    const p = new KeySequenceProcessor();
    expect(p.process("z", "column")).toEqual({ type: "none" });
  });

  it("reset and destroy clear pending state without throwing", () => {
    const p = new KeySequenceProcessor();
    p.process("d", "column"); // arm the timer
    expect(() => p.reset()).not.toThrow();
    expect(() => p.destroy()).not.toThrow();
  });
});
