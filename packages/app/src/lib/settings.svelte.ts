import { getDatabase, type DatabaseBackend } from "./db";

export type ThemeMode = "auto" | "dark" | "light";

export interface SettingsState {
  theme: ThemeMode;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  markdownEnabled: boolean;
  vimEnabled: boolean;
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
};

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
      this.loaded = true;
    }
  }

  /** Persist the current state. Writes are serialized via writeChain. */
  persist(): Promise<void> {
    const snapshot = JSON.stringify(this.state);
    this.writeChain = this.writeChain
      .catch(() => {})
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

  reset() {
    this.state = { ...DEFAULT_SETTINGS };
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
