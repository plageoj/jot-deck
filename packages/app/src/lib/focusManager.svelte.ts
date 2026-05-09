import type { FocusMode } from "$lib/keybindings";
import type { Card } from "$lib/types";
import type { DeckData } from "./deckData.svelte";

export type PaletteType = "column" | "deck" | "tag" | "trash" | "command" | null;

const FOCUS_STATE_PREFIX = "jot-deck:focus:";

type PersistedFocusState = {
  focusedColumnIndex: number;
  lastFocusedCardByColumn: Record<string, number>;
};

export class FocusManager {
  private data: DeckData;

  // Focus state
  focusMode = $state<FocusMode>("card");
  focusedColumnIndex = $state(0);
  focusedCardIndex = $state(0);
  editingCardId = $state<string | null>(null);

  // Overlay state
  showCheatsheet = $state(false);
  activePalette = $state<PaletteType>(null);
  previousFocusMode = $state<FocusMode>("column");

  // Per-column card index memory. Reactive so persistence effects fire on
  // mutation (Svelte 5 deep-proxies $state objects).
  lastFocusedCardByColumn = $state<Record<string, number>>({});

  // Clipboard
  clipboardCard = $state<Card | null>(null);

  // Scroll callback — set by the page component after mount
  onScrollToColumn: ((index: number) => void) | null = null;

  // Deck currently associated with persistence. Only set via setCurrentDeck.
  private currentDeckId: string | null = null;

  constructor(data: DeckData) {
    this.data = data;
  }

  scrollToFocusedColumn() {
    this.onScrollToColumn?.(this.focusedColumnIndex);
  }

  saveCurrentCardIndex() {
    const column = this.data.columns[this.focusedColumnIndex];
    if (column) {
      this.lastFocusedCardByColumn[column.id] = this.focusedCardIndex;
    }
  }

  restoreCardIndex() {
    const column = this.data.columns[this.focusedColumnIndex];
    if (!column) return;

    const cards = this.data.cardsByColumn[column.id] ?? [];
    const saved = this.lastFocusedCardByColumn[column.id];

    if (saved !== undefined && saved < cards.length) {
      this.focusedCardIndex = saved;
    } else {
      this.focusedCardIndex = Math.max(0, cards.length - 1);
    }
  }

  startEdit(cardId: string) {
    this.editingCardId = cardId;
    this.focusMode = "edit";
  }

  exitEdit() {
    this.editingCardId = null;
    this.focusMode = "card";
  }

  cancelEdit() {
    this.editingCardId = null;
  }

  openPalette(type: PaletteType) {
    if (this.focusMode === "command") return;
    this.showCheatsheet = false;
    this.previousFocusMode = this.focusMode;
    this.activePalette = type;
    this.focusMode = "command";
  }

  closePalette() {
    this.activePalette = null;
    this.focusMode = this.previousFocusMode;
  }

  handleFocusColumn(columnIndex: number) {
    if (this.focusedColumnIndex !== columnIndex) {
      this.saveCurrentCardIndex();
    }
    this.focusedColumnIndex = columnIndex;
    this.focusMode = "column";
  }

  handleFocusCard(columnIndex: number, cardIndex: number) {
    if (this.focusedColumnIndex !== columnIndex) {
      this.saveCurrentCardIndex();
    }
    this.focusedColumnIndex = columnIndex;
    this.focusedCardIndex = cardIndex;
    this.focusMode = "card";
  }

  // ============================================
  // Persistence
  // ============================================

  /**
   * Switch the deck associated with persisted focus state. Persists state for
   * the previous deck (if any) and loads state for the new deck. After columns
   * load for the new deck, call `clampToLoadedDeck()` to apply the restored
   * card index and clamp out-of-range positions.
   */
  setCurrentDeck(deckId: string | null) {
    if (this.currentDeckId === deckId) return;

    if (this.currentDeckId) {
      this.persistCurrent();
    }
    this.currentDeckId = deckId;

    if (deckId) {
      const state = this.loadState(deckId);
      this.lastFocusedCardByColumn = state?.lastFocusedCardByColumn
        ? { ...state.lastFocusedCardByColumn }
        : {};
      this.focusedColumnIndex = state?.focusedColumnIndex ?? 0;
    } else {
      this.lastFocusedCardByColumn = {};
      this.focusedColumnIndex = 0;
    }
    this.focusedCardIndex = 0;
  }

  /**
   * Apply saved card index for the focused column and clamp focus to current
   * deck size. Call after columns/cards finish loading for the active deck.
   */
  clampToLoadedDeck() {
    if (this.data.columns.length === 0) {
      this.focusedColumnIndex = 0;
      this.focusedCardIndex = 0;
      return;
    }
    if (this.focusedColumnIndex >= this.data.columns.length) {
      this.focusedColumnIndex = this.data.columns.length - 1;
    }
    this.restoreCardIndex();
  }

  /** Persist current focus state to localStorage for the active deck. */
  persistCurrent() {
    if (!this.currentDeckId) return;
    const snapshot: Record<string, number> = { ...this.lastFocusedCardByColumn };
    const column = this.data.columns[this.focusedColumnIndex];
    if (column) {
      snapshot[column.id] = this.focusedCardIndex;
    }
    try {
      localStorage.setItem(
        FOCUS_STATE_PREFIX + this.currentDeckId,
        JSON.stringify({
          focusedColumnIndex: this.focusedColumnIndex,
          lastFocusedCardByColumn: snapshot,
        } satisfies PersistedFocusState),
      );
    } catch {
      // localStorage unavailable — ignore
    }
  }

  /** Remove persisted focus state for a deck (e.g., after deck deletion). */
  static clearStateFor(deckId: string) {
    try {
      localStorage.removeItem(FOCUS_STATE_PREFIX + deckId);
    } catch {
      // ignore
    }
  }

  private loadState(deckId: string): PersistedFocusState | null {
    try {
      const raw = localStorage.getItem(FOCUS_STATE_PREFIX + deckId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedFocusState>;
      const focusedColumnIndex =
        typeof parsed.focusedColumnIndex === "number" &&
        parsed.focusedColumnIndex >= 0
          ? parsed.focusedColumnIndex
          : 0;
      const lastFocusedCardByColumn =
        parsed.lastFocusedCardByColumn &&
        typeof parsed.lastFocusedCardByColumn === "object"
          ? parsed.lastFocusedCardByColumn
          : {};
      return { focusedColumnIndex, lastFocusedCardByColumn };
    } catch {
      return null;
    }
  }
}
