import { describe, it, expect } from "vitest";
import {
  findAction,
  isValidPrefix,
  getKeybindingsForMode,
  DEFAULT_KEYBINDINGS,
} from "./keybindings";

describe("findAction", () => {
  it("should find single-key action in column mode", () => {
    expect(findAction("h", "column")).toBe("moveLeft");
    expect(findAction("l", "column")).toBe("moveRight");
    expect(findAction("j", "column")).toBe("enterCardFocusFirst");
    expect(findAction("r", "column")).toBe("renameColumn");
  });

  it("should find single-key action in card mode", () => {
    expect(findAction("j", "card")).toBe("moveDown");
    expect(findAction("k", "card")).toBe("moveUp");
    expect(findAction("i", "card")).toBe("startEdit");
  });

  it("should find multi-key sequence action", () => {
    expect(findAction("dd", "column")).toBe("deleteColumn");
    expect(findAction("dd", "card")).toBe("deleteCard");
    expect(findAction("yy", "card")).toBe("copyCard");
    expect(findAction("gg", "card")).toBe("goFirst");
  });

  it("should find parameterized jump actions", () => {
    expect(findAction("g1", "column")).toBe("jumpToColumn:0");
    expect(findAction("g1", "card")).toBe("jumpToColumn:0");
    expect(findAction("g9", "card")).toBe("jumpToColumn:8");
  });

  it("should find undo action in both modes", () => {
    expect(findAction("u", "column")).toBe("undo");
    expect(findAction("u", "card")).toBe("undo");
  });

  it("should return null for unknown sequences", () => {
    expect(findAction("x", "column")).toBeNull();
    expect(findAction("xyz", "card")).toBeNull();
  });

  it("should return null for sequence valid in wrong mode", () => {
    // "i" is for edit in card mode, not column mode
    expect(findAction("i", "column")).toBeNull();
  });
});

describe("isValidPrefix", () => {
  it("should return true for valid prefix", () => {
    expect(isValidPrefix("d", "column")).toBe(true); // "dd" exists
    expect(isValidPrefix("d", "card")).toBe(true); // "dd" exists
    expect(isValidPrefix("g", "column")).toBe(true); // "g1"-"g9", "gg" exist
    expect(isValidPrefix("g", "card")).toBe(true);
    expect(isValidPrefix("y", "card")).toBe(true); // "yy" exists
  });

  it("should return false for complete sequence", () => {
    expect(isValidPrefix("dd", "column")).toBe(false);
    expect(isValidPrefix("yy", "card")).toBe(false);
  });

  it("should return false for invalid prefix", () => {
    expect(isValidPrefix("x", "column")).toBe(false);
    expect(isValidPrefix("xy", "card")).toBe(false);
  });

  it("should return false for single-key actions", () => {
    // "h" is a complete action, not a prefix
    expect(isValidPrefix("h", "column")).toBe(false);
    expect(isValidPrefix("j", "card")).toBe(false);
  });
});

describe("getKeybindingsForMode", () => {
  it("should return keybindings for column mode", () => {
    const bindings = getKeybindingsForMode("column");
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.every((b) => b.modes.includes("column"))).toBe(true);
  });

  it("should return keybindings for card mode", () => {
    const bindings = getKeybindingsForMode("card");
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.every((b) => b.modes.includes("card"))).toBe(true);
  });

  it("should include shared bindings in both modes", () => {
    const columnBindings = getKeybindingsForMode("column");
    const cardBindings = getKeybindingsForMode("card");

    // "u" (undo) should be in both
    expect(columnBindings.some((b) => b.action === "undo")).toBe(true);
    expect(cardBindings.some((b) => b.action === "undo")).toBe(true);
  });
});

describe("DEFAULT_KEYBINDINGS consistency", () => {
  it("should have no duplicate sequences in same mode", () => {
    const seen = new Map<string, string>();

    for (const binding of DEFAULT_KEYBINDINGS) {
      for (const mode of binding.modes) {
        const key = `${mode}:${binding.sequence}`;
        if (seen.has(key)) {
          throw new Error(
            `Duplicate binding: ${key} (${seen.get(key)} and ${binding.action})`
          );
        }
        seen.set(key, binding.action);
      }
    }
  });

  it("should have descriptions for all bindings", () => {
    for (const binding of DEFAULT_KEYBINDINGS) {
      expect(binding.description).toBeTruthy();
    }
  });
});
