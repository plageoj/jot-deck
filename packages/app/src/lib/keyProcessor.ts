import { type FocusMode, findAction, isValidPrefix } from "./keybindings";

/** Modifier-only keys that never produce a sequence on their own. */
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

/** Keys that map directly to their own name as a sequence token. */
const DIRECT_KEYS: Record<string, string> = {
  Escape: "Escape",
  Enter: "Enter",
  Delete: "Delete",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

/** Build the "Ctrl+"/"Shift+" prefix for the active modifiers. */
function modifierPrefix(event: KeyboardEvent): string {
  let prefix = "";
  if (event.ctrlKey) prefix += "Ctrl+";
  if (event.shiftKey) prefix += "Shift+";
  return prefix;
}

/** Whether the key is a function key (F1, F2, …). */
function isFunctionKey(key: string): boolean {
  return (
    key.startsWith("F") && key.length >= 2 && !Number.isNaN(Number(key.slice(1)))
  );
}

/**
 * Normalize a keyboard event into a key sequence string.
 * Returns null for modifier-only keys or unrecognized keys.
 */
export function normalizeKey(event: KeyboardEvent): string | null {
  const { key } = event;

  if (MODIFIER_KEYS.has(key)) return null;

  const direct = DIRECT_KEYS[key];
  if (direct) return direct;

  if (isFunctionKey(key)) return key;

  if (key.startsWith("Arrow")) return modifierPrefix(event) + key;

  if (event.ctrlKey && key.length === 1) return modifierPrefix(event) + key;

  if (key.length === 1) return key;

  return null;
}

export type ProcessResult =
  | { type: "action"; action: string }
  | { type: "prefix" }
  | { type: "none" };

/**
 * Manages multi-key sequences (e.g. dd, gg, g1-g9) with a timeout.
 */
export class KeySequenceProcessor {
  private sequence = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly timeout: number;

  constructor(timeout = 500) {
    this.timeout = timeout;
  }

  process(key: string, mode: FocusMode): ProcessResult {
    const newSequence = this.sequence + key;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Exact match
    const action = findAction(newSequence, mode);
    if (action) {
      this.sequence = "";
      return { type: "action", action };
    }

    // Valid prefix — wait for more keys
    if (isValidPrefix(newSequence, mode)) {
      this.sequence = newSequence;
      this.timer = setTimeout(() => {
        this.sequence = "";
      }, this.timeout);
      return { type: "prefix" };
    }

    // No match on accumulated sequence — try single key
    this.sequence = "";
    const singleAction = findAction(key, mode);
    if (singleAction) {
      return { type: "action", action: singleAction };
    }

    return { type: "none" };
  }

  reset() {
    this.sequence = "";
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy() {
    this.reset();
  }
}
