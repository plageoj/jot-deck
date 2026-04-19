import type { FocusMode } from "$lib/keybindings";
import type { Card } from "$lib/types";
import type { DeckData } from "./deckData.svelte";

export class FocusManager {
  private data: DeckData;

  // Focus state
  focusMode = $state<FocusMode>("card");
  focusedColumnIndex = $state(0);
  focusedCardIndex = $state(0);
  editingCardId = $state<string | null>(null);

  // Overlay state
  showCheatsheet = $state(false);
  showColumnPalette = $state(false);
  showTagPalette = $state(false);
  previousFocusMode = $state<FocusMode>("column");

  // Per-column card index memory
  private lastFocusedCardByColumn: Record<string, number> = {};

  // Clipboard
  clipboardCard = $state<Card | null>(null);

  // Scroll callback — set by the page component after mount
  onScrollToColumn: ((index: number) => void) | null = null;

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

  openCommandPalette() {
    if (this.focusMode === "command") return;
    this.showCheatsheet = false;
    this.previousFocusMode = this.focusMode;
    this.focusMode = "command";
  }

  closeCommandPalette() {
    this.focusMode = this.previousFocusMode;
  }

  openColumnPalette() {
    if (this.focusMode === "command") return;
    this.showCheatsheet = false;
    this.previousFocusMode = this.focusMode;
    this.showColumnPalette = true;
    this.focusMode = "command";
  }

  closeColumnPalette() {
    this.showColumnPalette = false;
    this.focusMode = this.previousFocusMode;
  }

  openTagPalette() {
    if (this.focusMode === "command") return;
    this.showCheatsheet = false;
    this.previousFocusMode = this.focusMode;
    this.showTagPalette = true;
    this.focusMode = "command";
  }

  closeTagPalette() {
    this.showTagPalette = false;
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
}
