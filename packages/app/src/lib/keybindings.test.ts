import { describe, it, expect, afterEach } from "vitest";
import {
  findAction,
  isValidPrefix,
  getKeybindingsForMode,
  resolveKeybindings,
  setKeybindingOverrides,
  signatureOf,
  findKeybindingConflicts,
  getKnownActions,
  DEFAULT_KEYBINDINGS,
  type KeyBinding,
} from "./keybindings";

describe("findAction", () => {
  it("should find single-key action in column mode", () => {
    expect(findAction("h", "column")).toBe("moveLeft");
    expect(findAction("l", "column")).toBe("moveRight");
    expect(findAction("j", "column")).toBe("enterCardFocusFirst");
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

  it("should find tag filter action in both modes", () => {
    expect(findAction("/", "column")).toBe("openTagFilter");
    expect(findAction("/", "card")).toBe("openTagFilter");
  });

  it("should find undo action in both modes", () => {
    expect(findAction("u", "column")).toBe("undo");
    expect(findAction("u", "card")).toBe("undo");
  });

  it("should find trash palette action in both modes", () => {
    expect(findAction("gt", "column")).toBe("showTrashPalette");
    expect(findAction("gt", "card")).toBe("showTrashPalette");
  });

  it("should find settings action in both modes via Ctrl+,", () => {
    expect(findAction("Ctrl+,", "column")).toBe("showSettings");
    expect(findAction("Ctrl+,", "card")).toBe("showSettings");
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

  it("should return empty array for command mode", () => {
    const bindings = getKeybindingsForMode("command");
    expect(bindings).toEqual([]);
  });

  it("should include shared bindings in both modes", () => {
    const columnBindings = getKeybindingsForMode("column");
    const cardBindings = getKeybindingsForMode("card");

    // "u" (undo) should be in both
    expect(columnBindings.some((b) => b.action === "undo")).toBe(true);
    expect(cardBindings.some((b) => b.action === "undo")).toBe(true);
  });
});

describe("signatureOf", () => {
  it("produces a stable, unique signature for every default binding", () => {
    const sigs = DEFAULT_KEYBINDINGS.map(signatureOf);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("is order-independent across modes", () => {
    const a = signatureOf({
      sequence: "x",
      action: "foo",
      modes: ["column", "card"],
      description: "",
    });
    const b = signatureOf({
      sequence: "x",
      action: "foo",
      modes: ["card", "column"],
      description: "",
    });
    expect(a).toBe(b);
  });
});

describe("resolveKeybindings", () => {
  it("returns the defaults unchanged for empty overrides", () => {
    expect(resolveKeybindings({})).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("remaps a binding's sequence", () => {
    const moveLeft = DEFAULT_KEYBINDINGS.find(
      (b) => b.action === "moveLeft" && b.sequence === "h",
    )!;
    const sig = signatureOf(moveLeft);
    const resolved = resolveKeybindings({ [sig]: "a" });
    const remapped = resolved.find(
      (b) => b.action === "moveLeft" && b.modes.includes("column"),
    );
    expect(resolved.some((b) => b.sequence === "h" && b.action === "moveLeft"))
      .toBe(true); // the card-mode "h" binding is untouched
    expect(remapped?.sequence).toBe("a");
  });

  it("drops a binding when overridden to null or empty", () => {
    const undo = DEFAULT_KEYBINDINGS.find((b) => b.action === "undo")!;
    const sig = signatureOf(undo);
    expect(resolveKeybindings({ [sig]: null }).some((b) => b.action === "undo"))
      .toBe(false);
    expect(resolveKeybindings({ [sig]: "" }).some((b) => b.action === "undo"))
      .toBe(false);
  });

  it("ignores overrides whose signature matches no default", () => {
    expect(resolveKeybindings({ "nonexistent sig key": "z" })).toEqual(
      DEFAULT_KEYBINDINGS,
    );
  });

  it("appends user-added bindings after the defaults", () => {
    const added: KeyBinding = {
      sequence: "z",
      action: "undo",
      modes: ["card"],
      description: "Undo",
    };
    const resolved = resolveKeybindings({}, [added]);
    expect(resolved.length).toBe(DEFAULT_KEYBINDINGS.length + 1);
    expect(resolved[resolved.length - 1]).toEqual(added);
  });

  it("skips additions with an empty sequence", () => {
    const added: KeyBinding = {
      sequence: "",
      action: "undo",
      modes: ["card"],
      description: "Undo",
    };
    expect(resolveKeybindings({}, [added]).length).toBe(
      DEFAULT_KEYBINDINGS.length,
    );
  });
});

describe("getKnownActions", () => {
  it("returns one entry per distinct action", () => {
    const actions = getKnownActions();
    const distinct = new Set(DEFAULT_KEYBINDINGS.map((b) => b.action));
    expect(actions.length).toBe(distinct.size);
    expect(new Set(actions.map((a) => a.action)).size).toBe(actions.length);
  });

  it("unions the modes across an action's default bindings", () => {
    // "undo" is bound in both column and card modes.
    const undo = getKnownActions().find((a) => a.action === "undo");
    expect(undo?.modes).toEqual(expect.arrayContaining(["column", "card"]));
  });
});

describe("setKeybindingOverrides", () => {
  afterEach(() => setKeybindingOverrides({}));

  it("makes findAction reflect a remapped sequence", () => {
    const startEdit = DEFAULT_KEYBINDINGS.find(
      (b) => b.action === "startEdit" && b.sequence === "i",
    )!;
    setKeybindingOverrides({ [signatureOf(startEdit)]: "e" });
    expect(findAction("e", "card")).toBe("startEdit");
    expect(findAction("i", "card")).toBeNull();
  });

  it("makes isValidPrefix reflect a remapped multi-key sequence", () => {
    const deleteCard = DEFAULT_KEYBINDINGS.find(
      (b) => b.action === "deleteCard" && b.sequence === "dd",
    )!;
    setKeybindingOverrides({ [signatureOf(deleteCard)]: "xy" });
    expect(isValidPrefix("x", "card")).toBe(true);
    expect(findAction("xy", "card")).toBe("deleteCard");
  });

  it("removes a disabled binding from findAction", () => {
    const undo = DEFAULT_KEYBINDINGS.find((b) => b.action === "undo")!;
    setKeybindingOverrides({ [signatureOf(undo)]: null });
    expect(findAction("u", "card")).toBeNull();
  });

  it("makes findAction resolve a user-added binding", () => {
    setKeybindingOverrides({}, [
      { sequence: "z", action: "undo", modes: ["card"], description: "Undo" },
    ]);
    expect(findAction("z", "card")).toBe("undo");
  });
});

describe("findKeybindingConflicts", () => {
  it("flags an exact-sequence collision in an overlapping mode as an error", () => {
    // "j" in card mode is moveDown; trying to also bind it elsewhere in card.
    const conflicts = findKeybindingConflicts("j", ["card"], "no-such-sig");
    expect(conflicts.some((c) => c.severity === "error")).toBe(true);
  });

  it("excludes the binding being edited", () => {
    const moveDown = DEFAULT_KEYBINDINGS.find(
      (b) => b.action === "moveDown" && b.sequence === "j",
    )!;
    const conflicts = findKeybindingConflicts(
      "j",
      ["card"],
      signatureOf(moveDown),
    );
    expect(conflicts.some((c) => c.severity === "error")).toBe(false);
  });

  it("excludes an already-remapped default from self-conflict", () => {
    // moveDown was remapped j -> x. Re-opening its remap and pressing "x"
    // again must not report a conflict against itself — the exclude key is the
    // stable (default-sequence) signature, not the remapped one.
    const moveDown = DEFAULT_KEYBINDINGS.find(
      (b) => b.action === "moveDown" && b.sequence === "j",
    )!;
    const sig = signatureOf(moveDown);
    const conflicts = findKeybindingConflicts("x", ["card"], sig, {
      [sig]: "x",
    });
    expect(conflicts.some((c) => c.severity === "error")).toBe(false);
  });

  it("does not conflict across non-overlapping modes", () => {
    // "o" is createCard in column and createCardBelow in card. A candidate
    // bound only in column should not clash with a card-only binding.
    const conflicts = findKeybindingConflicts("i", ["column"], "no-such-sig");
    // "i" (startEdit) is card-only, so no error in column mode.
    expect(conflicts.some((c) => c.severity === "error")).toBe(false);
  });

  it("warns on a prefix overlap", () => {
    // "g" is a strict prefix of "gg", "g1", "gt", etc. in card mode.
    const conflicts = findKeybindingConflicts("g", ["card"], "no-such-sig");
    expect(conflicts.some((c) => c.severity === "warn")).toBe(true);
  });

  it("detects a collision against a user-added binding", () => {
    const added: KeyBinding = {
      sequence: "z",
      action: "undo",
      modes: ["card"],
      description: "Undo",
    };
    const conflicts = findKeybindingConflicts(
      "z",
      ["card"],
      "no-such-sig",
      {},
      [added],
    );
    expect(conflicts.some((c) => c.severity === "error")).toBe(true);
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
