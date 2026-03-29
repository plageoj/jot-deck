import { type FocusMode, findAction, isValidPrefix } from "./keybindings";

/**
 * Normalize a keyboard event into a key sequence string.
 * Returns null for modifier-only keys or unrecognized keys.
 */
export function normalizeKey(event: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
    return null;
  }

  if (event.key === "Escape") return "Escape";
  if (event.key === "Enter") return "Enter";
  if (event.key === "Delete") return "Delete";
  if (event.key === "PageUp") return "PageUp";
  if (event.key === "PageDown") return "PageDown";

  if (event.key.startsWith("Arrow")) {
    let prefix = "";
    if (event.ctrlKey) prefix += "Ctrl+";
    if (event.shiftKey) prefix += "Shift+";
    return prefix + event.key;
  }

  if (event.ctrlKey && event.key.length === 1) {
    return "Ctrl+" + event.key;
  }

  if (event.key.length === 1) {
    return event.key;
  }

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
