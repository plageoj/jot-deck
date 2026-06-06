import { getDatabase, type DatabaseBackend } from "./db";
import {
  setKeybindingOverrides,
  type FocusMode,
  type KeyBinding,
  type KeybindingOverrides,
} from "./keybindings";

export type ThemeMode = "auto" | "dark" | "light";

export interface SettingsState {
  theme: ThemeMode;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  markdownEnabled: boolean;
  vimEnabled: boolean;
  /**
   * User keybinding customizations, keyed by a default binding's stable
   * signature (see `signatureOf` in keybindings.ts). Value is the replacement
   * key sequence, or `null` to disable the binding.
   */
  keybindingOverrides: KeybindingOverrides;
  /**
   * Brand-new keybindings the user has added (not derived from defaults).
   * Appended to the resolved defaults by `resolveKeybindings`.
   */
  customKeybindings: KeyBinding[];
}

export const SETTINGS_DB_KEY = "app";

export const DEFAULT_SETTINGS: SettingsState = {
  theme: "auto",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
  fontSize: 14,
  lineHeight: 1.5,
  markdownEnabled: false,
  vimEnabled: false,
  keybindingOverrides: {},
  customKeybindings: [],
};

/**
 * Defensively coerce a raw value into a KeybindingOverrides map: an object
 * whose values are strings or null. Anything else is dropped.
 */
function coerceKeybindingOverrides(value: unknown): KeybindingOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: KeybindingOverrides = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || typeof raw === "string") {
      result[key] = raw;
    }
  }
  return result;
}

const VALID_MODES = new Set<FocusMode>(["column", "card", "edit", "command"]);

/**
 * Defensively coerce a raw value into a list of well-formed KeyBindings. Each
 * entry must have a non-empty string sequence + action and a non-empty array of
 * valid focus modes; anything malformed is dropped.
 */
function coerceCustomKeybindings(value: unknown): KeyBinding[] {
  if (!Array.isArray(value)) return [];
  const result: KeyBinding[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Partial<KeyBinding>;
    if (typeof b.sequence !== "string" || !b.sequence) continue;
    if (typeof b.action !== "string" || !b.action) continue;
    if (!Array.isArray(b.modes)) continue;
    const modes = b.modes.filter((m) => VALID_MODES.has(m));
    if (modes.length === 0) continue;
    result.push({
      sequence: b.sequence,
      action: b.action,
      modes,
      description: typeof b.description === "string" ? b.description : b.action,
    });
  }
  return result;
}

export const FONT_FAMILY_PRESETS = [
  {
    label: "System Sans",
    value:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
  },
  {
    label: "System Serif",
    value: 'Georgia, "Times New Roman", Times, serif',
  },
  {
    label: "System Mono",
    value:
      '"Cascadia Code", "Consolas", "Menlo", "Liberation Mono", monospace',
  },
];

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 22;
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 2.2;

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Parse a JSON string from the settings table and merge it with defaults,
 * defensively coercing each field. Unknown values fall back to defaults.
 */
export function deserializeSettings(raw: string | null): SettingsState {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let parsed: Partial<SettingsState>;
  try {
    parsed = JSON.parse(raw) as Partial<SettingsState>;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    theme:
      parsed.theme === "dark" || parsed.theme === "light"
        ? parsed.theme
        : "auto",
    fontFamily:
      typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
        ? parsed.fontFamily
        : DEFAULT_SETTINGS.fontFamily,
    fontSize: clampNumber(
      typeof parsed.fontSize === "number"
        ? parsed.fontSize
        : DEFAULT_SETTINGS.fontSize,
      FONT_SIZE_MIN,
      FONT_SIZE_MAX,
    ),
    lineHeight: clampNumber(
      typeof parsed.lineHeight === "number"
        ? parsed.lineHeight
        : DEFAULT_SETTINGS.lineHeight,
      LINE_HEIGHT_MIN,
      LINE_HEIGHT_MAX,
    ),
    markdownEnabled:
      typeof parsed.markdownEnabled === "boolean"
        ? parsed.markdownEnabled
        : DEFAULT_SETTINGS.markdownEnabled,
    vimEnabled:
      typeof parsed.vimEnabled === "boolean"
        ? parsed.vimEnabled
        : DEFAULT_SETTINGS.vimEnabled,
    keybindingOverrides: coerceKeybindingOverrides(parsed.keybindingOverrides),
    customKeybindings: coerceCustomKeybindings(parsed.customKeybindings),
  };
}

export class SettingsStore {
  state = $state<SettingsState>({ ...DEFAULT_SETTINGS });
  loaded = $state(false);

  private getBackend: () => Promise<DatabaseBackend>;

  // Serialize writes so concurrent updates land in order.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(getBackend: () => Promise<DatabaseBackend> = getDatabase) {
    this.getBackend = getBackend;
  }

  async load(): Promise<void> {
    try {
      const backend = await this.getBackend();
      const raw = await backend.getSettings(SETTINGS_DB_KEY);
      this.state = deserializeSettings(raw);
    } catch {
      this.state = { ...DEFAULT_SETTINGS };
    } finally {
      this.applyKeybindings();
      this.loaded = true;
    }
  }

  /** Push the current keybinding customization into the active registry. */
  applyKeybindings() {
    setKeybindingOverrides(
      this.state.keybindingOverrides,
      this.state.customKeybindings,
    );
  }

  /** Persist the current state. Writes are serialized via writeChain. */
  persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state);
    this.writeChain = this.writeChain
      .catch((err) => {
        // Surface the previous failure so it isn't lost when chained writes
        // recover. We don't rethrow because subsequent writes should still
        // attempt persistence — a transient DB hiccup shouldn't permanently
        // disable saves for the rest of the session.
        console.warn("[settings] persistence failed:", err);
      })
      .then(async () => {
        const backend = await this.getBackend();
        await backend.setSettings(SETTINGS_DB_KEY, snapshot);
      });
    return this.writeChain;
  }

  update<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    this.state[key] = value;
    void this.persist();
  }

  /**
   * Set (or, with `sequence === null`, disable) the override for a single
   * binding signature. Re-applies the active registry and persists.
   */
  setKeybindingOverride(signature: string, sequence: string | null) {
    this.state.keybindingOverrides = {
      ...this.state.keybindingOverrides,
      [signature]: sequence,
    };
    this.applyKeybindings();
    void this.persist();
  }

  /**
   * Remove several overrides at once, restoring those bindings to their
   * defaults. Used to reset a single binding or a whole command (action group).
   */
  clearKeybindingOverrides(signatures: string[]) {
    const next = { ...this.state.keybindingOverrides };
    let changed = false;
    for (const sig of signatures) {
      if (Object.hasOwn(next, sig)) {
        delete next[sig];
        changed = true;
      }
    }
    if (!changed) return;
    this.state.keybindingOverrides = next;
    this.applyKeybindings();
    void this.persist();
  }

  /** Append a brand-new user-defined binding. */
  addCustomKeybinding(binding: KeyBinding) {
    this.state.customKeybindings = [...this.state.customKeybindings, binding];
    this.applyKeybindings();
    void this.persist();
  }

  /** Replace the custom binding at `index` (e.g. after remapping its key). */
  updateCustomKeybinding(index: number, binding: KeyBinding) {
    if (index < 0 || index >= this.state.customKeybindings.length) return;
    const next = [...this.state.customKeybindings];
    next[index] = binding;
    this.state.customKeybindings = next;
    this.applyKeybindings();
    void this.persist();
  }

  /** Remove the custom binding at `index`. */
  removeCustomKeybinding(index: number) {
    if (index < 0 || index >= this.state.customKeybindings.length) return;
    this.state.customKeybindings = this.state.customKeybindings.filter(
      (_, i) => i !== index,
    );
    this.applyKeybindings();
    void this.persist();
  }

  /** Drop every customization — both default overrides and added bindings. */
  resetAllKeybindings() {
    this.state.keybindingOverrides = {};
    this.state.customKeybindings = [];
    this.applyKeybindings();
    void this.persist();
  }

  reset() {
    this.state = { ...DEFAULT_SETTINGS };
    this.applyKeybindings();
    void this.persist();
  }
}

/**
 * Apply settings to the document root: theme attribute + CSS custom
 * properties for font family / size / line height. Returns nothing — call
 * inside an effect that re-runs when settings change.
 */
export function applySettingsToDocument(state: SettingsState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.style.setProperty("--app-font-family", state.fontFamily);
  root.style.setProperty("--app-font-size", `${state.fontSize}px`);
  root.style.setProperty("--app-line-height", String(state.lineHeight));
}

/**
 * Shared singleton. Components read reactive settings via `settingsStore.state`.
 * The root layout calls `await load()` on mount and applies values to the document.
 */
export const settingsStore = new SettingsStore();
