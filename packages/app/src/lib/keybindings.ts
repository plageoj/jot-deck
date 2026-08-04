export type FocusMode = "column" | "card" | "edit" | "command";

export interface KeyBinding {
  sequence: string;
  action: string;
  modes: FocusMode[];
  description: string;
}

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Column focus - Navigation
  { sequence: "h", action: "moveLeft", modes: ["column"], description: "Move to left column" },
  { sequence: "ArrowLeft", action: "moveLeft", modes: ["column"], description: "Move to left column" },
  { sequence: "l", action: "moveRight", modes: ["column"], description: "Move to right column" },
  { sequence: "ArrowRight", action: "moveRight", modes: ["column"], description: "Move to right column" },
  { sequence: "j", action: "enterCardFocusFirst", modes: ["column"], description: "Focus first card" },
  { sequence: "ArrowDown", action: "enterCardFocusFirst", modes: ["column"], description: "Focus first card" },
  { sequence: "k", action: "enterCardFocusLast", modes: ["column"], description: "Focus last card" },
  { sequence: "ArrowUp", action: "enterCardFocusLast", modes: ["column"], description: "Focus last card" },
  { sequence: "Enter", action: "enterCardFocusFirst", modes: ["column"], description: "Focus first card" },

  // Column focus - Operations
  { sequence: "H", action: "reorderColumnLeft", modes: ["column"], description: "Move column left" },
  { sequence: "Shift+ArrowLeft", action: "reorderColumnLeft", modes: ["column"], description: "Move column left" },
  { sequence: "L", action: "reorderColumnRight", modes: ["column"], description: "Move column right" },
  { sequence: "Shift+ArrowRight", action: "reorderColumnRight", modes: ["column"], description: "Move column right" },
  { sequence: "o", action: "createCard", modes: ["column"], description: "New card" },
  { sequence: "n", action: "createCard", modes: ["column"], description: "New card" },
  { sequence: "c", action: "createColumn", modes: ["column"], description: "New column" },
  { sequence: "N", action: "createColumn", modes: ["column", "card"], description: "New column" },
  { sequence: "dd", action: "deleteColumn", modes: ["column"], description: "Delete column" },
  { sequence: "Delete", action: "deleteColumn", modes: ["column"], description: "Delete column" },

  // Card focus - Navigation
  { sequence: "j", action: "moveDown", modes: ["card"], description: "Move down" },
  { sequence: "ArrowDown", action: "moveDown", modes: ["card"], description: "Move down" },
  { sequence: "k", action: "moveUp", modes: ["card"], description: "Move up" },
  { sequence: "ArrowUp", action: "moveUp", modes: ["card"], description: "Move up" },
  { sequence: "h", action: "moveLeft", modes: ["card"], description: "Move to left column" },
  { sequence: "ArrowLeft", action: "moveLeft", modes: ["card"], description: "Move to left column" },
  { sequence: "l", action: "moveRight", modes: ["card"], description: "Move to right column" },
  { sequence: "ArrowRight", action: "moveRight", modes: ["card"], description: "Move to right column" },
  { sequence: "gg", action: "goFirst", modes: ["card"], description: "Go to first" },
  { sequence: "Ctrl+ArrowUp", action: "goFirst", modes: ["card"], description: "Go to first" },
  { sequence: "G", action: "goLast", modes: ["card"], description: "Go to last" },
  { sequence: "Ctrl+ArrowDown", action: "goLast", modes: ["card"], description: "Go to last" },
  { sequence: "Ctrl+u", action: "scrollHalfPageUp", modes: ["card"], description: "Half page up" },
  { sequence: "PageUp", action: "scrollHalfPageUp", modes: ["card"], description: "Half page up" },
  { sequence: "Ctrl+d", action: "scrollHalfPageDown", modes: ["card"], description: "Half page down" },
  { sequence: "PageDown", action: "scrollHalfPageDown", modes: ["card"], description: "Half page down" },
  { sequence: "Escape", action: "exitToColumn", modes: ["card"], description: "Back to column focus" },

  // Card focus - Move card
  { sequence: "H", action: "moveCardLeft", modes: ["card"], description: "Move card to left column" },
  { sequence: "Shift+ArrowLeft", action: "moveCardLeft", modes: ["card"], description: "Move card to left column" },
  { sequence: "L", action: "moveCardRight", modes: ["card"], description: "Move card to right column" },
  { sequence: "Shift+ArrowRight", action: "moveCardRight", modes: ["card"], description: "Move card to right column" },
  { sequence: "J", action: "reorderCardDown", modes: ["card"], description: "Move card down" },
  { sequence: "Shift+ArrowDown", action: "reorderCardDown", modes: ["card"], description: "Move card down" },
  { sequence: "K", action: "reorderCardUp", modes: ["card"], description: "Move card up" },
  { sequence: "Shift+ArrowUp", action: "reorderCardUp", modes: ["card"], description: "Move card up" },

  // Card focus - Edit
  { sequence: "i", action: "startEdit", modes: ["card"], description: "Edit card" },
  { sequence: "a", action: "startEdit", modes: ["card"], description: "Edit card" },
  { sequence: "Enter", action: "startEdit", modes: ["card"], description: "Edit card" },

  // Card focus - Create
  { sequence: "o", action: "createCardBelow", modes: ["card"], description: "New card below" },
  { sequence: "n", action: "createCardBelow", modes: ["card"], description: "New card below" },
  { sequence: "O", action: "createCardAbove", modes: ["card"], description: "New card above" },

  // Card focus - Delete/Copy/Paste
  { sequence: "dd", action: "deleteCard", modes: ["card"], description: "Delete card" },
  { sequence: "Delete", action: "deleteCard", modes: ["card"], description: "Delete card" },
  { sequence: "yy", action: "copyCard", modes: ["card"], description: "Copy card" },
  { sequence: "p", action: "pasteBelow", modes: ["card"], description: "Paste below" },
  { sequence: "P", action: "pasteAbove", modes: ["card"], description: "Paste above" },

  // Card focus - Score
  { sequence: "f", action: "scoreUp", modes: ["card"], description: "Score +1" },
  { sequence: "+", action: "scoreUp", modes: ["card"], description: "Score +1" },
  { sequence: "=", action: "scoreUp", modes: ["card"], description: "Score +1" },
  { sequence: "F", action: "scoreDown", modes: ["card"], description: "Score -1" },
  { sequence: "-", action: "scoreDown", modes: ["card"], description: "Score -1" },

  // Common - Jump to column (g prefix)
  { sequence: "g1", action: "jumpToColumn:0", modes: ["column", "card"], description: "Jump to column 1" },
  { sequence: "g2", action: "jumpToColumn:1", modes: ["column", "card"], description: "Jump to column 2" },
  { sequence: "g3", action: "jumpToColumn:2", modes: ["column", "card"], description: "Jump to column 3" },
  { sequence: "g4", action: "jumpToColumn:3", modes: ["column", "card"], description: "Jump to column 4" },
  { sequence: "g5", action: "jumpToColumn:4", modes: ["column", "card"], description: "Jump to column 5" },
  { sequence: "g6", action: "jumpToColumn:5", modes: ["column", "card"], description: "Jump to column 6" },
  { sequence: "g7", action: "jumpToColumn:6", modes: ["column", "card"], description: "Jump to column 7" },
  { sequence: "g8", action: "jumpToColumn:7", modes: ["column", "card"], description: "Jump to column 8" },
  { sequence: "g9", action: "jumpToColumn:8", modes: ["column", "card"], description: "Jump to column 9" },

  // Common - Column palette
  { sequence: "gn", action: "showColumnPalette", modes: ["column", "card"], description: "Switch column" },
  { sequence: "gc", action: "showColumnPalette", modes: ["column", "card"], description: "Switch column" },
  { sequence: "Ctrl+t", action: "showColumnPalette", modes: ["column", "card"], description: "Switch column" },

  // Common - Tag filter
  { sequence: "/", action: "openTagFilter", modes: ["column", "card"], description: "Filter by tag" },

  // Common - Undo
  { sequence: "u", action: "undo", modes: ["column", "card"], description: "Undo" },

  // Common - Trash
  { sequence: "gt", action: "showTrashPalette", modes: ["column", "card"], description: "Open trash" },

  // Common - Palettes
  { sequence: "Ctrl+p", action: "showDeckPalette", modes: ["column", "card"], description: "Switch deck" },
  { sequence: "Ctrl+Shift+P", action: "showCommandPalette", modes: ["column", "card"], description: "Command palette" },
  { sequence: "F1", action: "showCommandPalette", modes: ["column", "card"], description: "Command palette" },

  // Common - Settings
  { sequence: "Ctrl+,", action: "showSettings", modes: ["column", "card"], description: "Open settings" },

  // Common - Reporters
  { sequence: "gr", action: "showReporters", modes: ["column", "card"], description: "Manage reporters" },
];

/**
 * User customization is stored as a map keyed by a *default* binding's stable
 * signature. The value is the user's replacement key sequence, or `null` to
 * disable the binding entirely. Keying off the immutable default (action +
 * modes + default sequence) keeps overrides stable even after the user remaps
 * the effective sequence, and lets stale overrides for removed defaults be
 * dropped harmlessly on resolution.
 */
export type KeybindingOverrides = Record<string, string | null>;

/**
 * Stable identity for a default binding. The default `sequence` never changes
 * (it lives in source), so the signature survives remapping of the effective
 * key.
 */
export function signatureOf(binding: KeyBinding): string {
  const modes = [...binding.modes].sort((a, b) => a.localeCompare(b)).join(",");
  return `${binding.action} ${modes} ${binding.sequence}`;
}

interface ResolvedBinding extends KeyBinding {
  /**
   * Stable signature of the originating binding (the default's signature for
   * overridden/default bindings, the addition's own signature otherwise).
   * Unlike `signatureOf(this)`, it does not change when the effective
   * `sequence` is remapped — so it can identify the binding being edited.
   */
  signature: string;
}

/**
 * Resolve effective bindings while preserving each one's stable signature.
 * Shared by `resolveKeybindings` (which projects away the signature) and
 * `findKeybindingConflicts` (which needs it to exclude the edited binding).
 */
function resolveWithSignatures(
  overrides: KeybindingOverrides,
  additions: KeyBinding[]
): ResolvedBinding[] {
  const resolved: ResolvedBinding[] = [];
  for (const binding of DEFAULT_KEYBINDINGS) {
    const signature = signatureOf(binding);
    if (Object.hasOwn(overrides, signature)) {
      const seq = overrides[signature];
      if (seq === null || seq === "") continue; // disabled
      resolved.push({ ...binding, sequence: seq, signature });
    } else {
      resolved.push({ ...binding, signature });
    }
  }
  for (const binding of additions) {
    if (binding.sequence) {
      resolved.push({ ...binding, signature: signatureOf(binding) });
    }
  }
  return resolved;
}

/**
 * Resolve the effective keybinding list by layering user overrides over the
 * defaults, then appending user-added bindings. A `null` override disables
 * (drops) the binding; a string override replaces its key sequence. Pure —
 * does not touch the active registry.
 */
export function resolveKeybindings(
  overrides: KeybindingOverrides = {},
  additions: KeyBinding[] = []
): KeyBinding[] {
  return resolveWithSignatures(overrides, additions).map((b) => ({
    sequence: b.sequence,
    action: b.action,
    modes: b.modes,
    description: b.description,
  }));
}

export interface KnownAction {
  action: string;
  description: string;
  /** Union of focus modes the action's default bindings apply to. */
  modes: FocusMode[];
}

/**
 * The distinct actions that can be bound, derived from the defaults (in source
 * order). Used to populate the "add binding" action picker. Each action's
 * `modes` is the union of the modes its default bindings use, which seeds a
 * sensible default scope for a new binding.
 */
export function getKnownActions(): KnownAction[] {
  const index = new Map<string, KnownAction>();
  for (const b of DEFAULT_KEYBINDINGS) {
    const existing = index.get(b.action);
    if (existing) {
      for (const m of b.modes) {
        if (!existing.modes.includes(m)) existing.modes.push(m);
      }
    } else {
      index.set(b.action, {
        action: b.action,
        description: b.description,
        modes: [...b.modes],
      });
    }
  }
  return [...index.values()];
}

// The currently active bindings consulted by findAction / isValidPrefix /
// getKeybindingsForMode. Starts as the defaults; the settings layer calls
// setKeybindingOverrides() once persisted customizations have loaded.
let activeBindings: KeyBinding[] = DEFAULT_KEYBINDINGS;

/**
 * Replace the active bindings with defaults + the given overrides + the user's
 * added bindings. Call this whenever the persisted customization changes.
 */
export function setKeybindingOverrides(
  overrides: KeybindingOverrides,
  additions: KeyBinding[] = []
): void {
  activeBindings = resolveKeybindings(overrides, additions);
}

/**
 * Find the action for a given key sequence and focus mode
 */
export function findAction(sequence: string, mode: FocusMode): string | null {
  const binding = activeBindings.find(
    (b) => b.sequence === sequence && b.modes.includes(mode)
  );
  return binding?.action ?? null;
}

/**
 * Check if the given sequence is a valid prefix for any keybinding
 */
export function isValidPrefix(sequence: string, mode: FocusMode): boolean {
  return activeBindings.some(
    (b) =>
      b.sequence.startsWith(sequence) &&
      b.sequence !== sequence &&
      b.modes.includes(mode)
  );
}

/**
 * Get all keybindings for display (cheatsheet)
 */
export function getKeybindingsForMode(mode: FocusMode): KeyBinding[] {
  return activeBindings.filter((b) => b.modes.includes(mode));
}

export interface KeybindingConflict {
  severity: "error" | "warn";
  /** The conflicting binding's key sequence. */
  sequence: string;
  /** Human-readable description of the conflicting binding. */
  description: string;
}

/**
 * Check whether assigning `candidate` to a binding in `modes` would clash with
 * another effective binding. `excludeSignature` is the signature of the
 * binding being edited, so it doesn't conflict with itself.
 *
 * - `error`: an exact-sequence collision in an overlapping mode (the new key is
 *   already taken — only one action can win).
 * - `warn`: a prefix overlap in an overlapping mode (one sequence is a strict
 *   prefix of the other, so the shorter one shadows the longer during multi-key
 *   entry).
 */
export function findKeybindingConflicts(
  candidate: string,
  modes: FocusMode[],
  excludeSignature: string,
  overrides: KeybindingOverrides = {},
  additions: KeyBinding[] = []
): KeybindingConflict[] {
  const effective = resolveWithSignatures(overrides, additions);
  const conflicts: KeybindingConflict[] = [];
  for (const b of effective) {
    if (b.signature === excludeSignature) continue;
    const sharesMode = b.modes.some((m) => modes.includes(m));
    if (!sharesMode) continue;
    if (b.sequence === candidate) {
      conflicts.push({
        severity: "error",
        sequence: b.sequence,
        description: b.description,
      });
    } else if (
      b.sequence.startsWith(candidate) ||
      candidate.startsWith(b.sequence)
    ) {
      conflicts.push({
        severity: "warn",
        sequence: b.sequence,
        description: b.description,
      });
    }
  }
  return conflicts;
}
