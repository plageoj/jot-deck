import type { DeckData } from "./deckData.svelte";
import type { FocusManager } from "./focusManager.svelte";
import type { Card, Column } from "./types";
import { findAction } from "./keybindings";
import { normalizeKey, KeySequenceProcessor } from "./keyProcessor";
import { updaterStore } from "./updater.svelte";

const HALF_PAGE_SIZE = 5;

export class ActionDispatcher {
  private readonly data: DeckData;
  private readonly focus: FocusManager;
  private readonly keyProcessor = new KeySequenceProcessor();

  // Callbacks for actions that require UI interaction
  onRenameDeck: (() => void) | null = null;
  onDeleteDeck: (() => void) | null = null;
  onRenameColumn: (() => void) | null = null;
  onDeleteColumn: (() => void) | null = null;

  constructor(data: DeckData, focus: FocusManager) {
    this.data = data;
    this.focus = focus;
  }

  // ============================================
  // Focus context helpers
  // ============================================

  private get focusedColumn(): Column {
    return this.data.columns[this.focus.focusedColumnIndex];
  }

  private get focusedCards(): Card[] {
    return this.data.cardsByColumn[this.focusedColumn?.id] ?? [];
  }

  private get focusedCard(): Card {
    return this.focusedCards[this.focus.focusedCardIndex];
  }

  // ============================================
  // Keyboard handling
  // ============================================

  handleKeydown = (event: KeyboardEvent) => {
    const { focus, data } = this;

    if (focus.focusMode === "edit") return;

    // Skip if a palette is open (it handles its own keys)
    // Exception: palette triggers (Ctrl+P, Ctrl+Shift+P, F1) must still be processed
    if (focus.focusMode === "command") {
      this.handleCommandModeKey(event);
      return;
    }

    // Block all board shortcuts while cheatsheet is open
    if (focus.showCheatsheet) {
      this.handleCheatsheetKey(event);
      return;
    }

    // Settings / keybindings / about dialogs manage their own input — let them handle keys.
    if (focus.showSettings || focus.showKeybindings || focus.showAbout) return;

    // Skip if focus is on input fields
    if (this.isEditableTarget(event.target as HTMLElement)) return;

    // Cheatsheet trigger: ? or Ctrl+/
    if (this.toggleCheatsheetIfTrigger(event)) return;

    // Clear tag filter with Escape when active
    if (event.key === "Escape" && data.activeTagFilter) {
      event.preventDefault();
      data.clearTagFilter();
      return;
    }

    // No columns: treat keys as column-focus bindings and allow a whitelist
    // through (palette triggers, createColumn, undo). Other column-focus keys
    // have nothing to act on, so we ignore them.
    if (data.columns.length === 0) {
      this.handleNoColumnsKey(event);
      return;
    }

    const key = normalizeKey(event);
    if (!key) return;

    const result = this.keyProcessor.process(key, focus.focusMode);
    if (result.type === "action") {
      event.preventDefault();
      this.executeAction(result.action);
    } else if (result.type === "prefix") {
      event.preventDefault();
    }
  };

  private handleCommandModeKey(event: KeyboardEvent) {
    const key = normalizeKey(event);
    if (!key) return;
    const action = findAction(key, "column");
    if (action === "showCommandPalette" || action === "showDeckPalette") {
      event.preventDefault();
      this.executeAction(action);
    }
  }

  private handleCheatsheetKey(event: KeyboardEvent) {
    if (
      event.key === "Escape" ||
      event.key === "?" ||
      (event.shiftKey && event.key === "/") ||
      (event.ctrlKey && event.key === "/")
    ) {
      event.preventDefault();
      this.focus.showCheatsheet = false;
    }
  }

  private isEditableTarget(target: HTMLElement): boolean {
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    );
  }

  private toggleCheatsheetIfTrigger(event: KeyboardEvent): boolean {
    if (
      event.key === "?" ||
      (event.shiftKey && event.key === "/") ||
      (event.ctrlKey && event.key === "/")
    ) {
      event.preventDefault();
      this.focus.showCheatsheet = !this.focus.showCheatsheet;
      return true;
    }
    return false;
  }

  private handleNoColumnsKey(event: KeyboardEvent) {
    const key = normalizeKey(event);
    if (!key) return;
    const action = findAction(key, "column");
    if (
      action === "showDeckPalette" ||
      action === "showCommandPalette" ||
      action === "showSettings" ||
      action === "undo"
    ) {
      event.preventDefault();
      this.executeAction(action);
    } else if (action === "createColumn") {
      event.preventDefault();
      this.executeColumnAction("createColumn");
    }
  }

  // ============================================
  // Action dispatch
  // ============================================

  async executeAction(action: string) {
    if (action === "showCommandPalette") {
      this.focus.openPalette("command");
      return;
    }

    if (action === "showDeckPalette") {
      this.focus.openPalette("deck");
      return;
    }

    if (action === "showColumnPalette") {
      this.focus.openPalette("column");
      return;
    }

    if (action === "openTagFilter") {
      this.focus.openPalette("tag");
      return;
    }

    if (action === "showTrashPalette") {
      this.focus.openPalette("trash");
      return;
    }

    if (action === "showSettings") {
      this.focus.showSettings = true;
      return;
    }

    if (action === "showKeybindings") {
      this.focus.showKeybindings = true;
      return;
    }

    if (action === "showAbout") {
      this.focus.showAbout = true;
      return;
    }

    if (action === "checkForUpdates") {
      // Surface the result inline in the About dialog, then kick off the
      // check — a manual check that finds nothing is otherwise silent.
      this.focus.showAbout = true;
      void updaterStore.check();
      return;
    }

    if (action === "clearTagFilter") {
      this.data.clearTagFilter();
      return;
    }

    if (action === "undo") {
      await this.data.undoLastDelete();
      return;
    }

    const [actionName, param] = action.split(":");

    if (actionName === "jumpToColumn") {
      this.jumpToColumn(param);
      return;
    }

    if (this.focus.focusMode === "column") {
      await this.executeColumnAction(actionName, param);
    } else if (this.focus.focusMode === "card") {
      await this.executeCardAction(actionName, param);
    }
  }

  // ============================================
  // Column focus actions
  // ============================================

  async executeColumnAction(action: string, _param?: string) {
    switch (action) {
      case "moveLeft":
        this.columnMoveLeft();
        break;
      case "moveRight":
        this.columnMoveRight();
        break;
      case "enterCardFocusFirst":
        this.columnEnterCardFocus(0);
        break;
      case "enterCardFocusLast":
        this.columnEnterCardFocus(this.focusedCards.length - 1);
        break;
      case "reorderColumnLeft":
        await this.columnReorder(-1);
        break;
      case "reorderColumnRight":
        await this.columnReorder(1);
        break;
      case "createCard":
        await this.columnCreateCard();
        break;
      case "createColumn":
        await this.columnCreateColumn();
        break;
      case "deleteColumn":
        await this.columnDelete();
        break;
    }
  }

  private columnMoveLeft() {
    const { focus } = this;
    if (focus.focusedColumnIndex > 0) {
      focus.focusedColumnIndex--;
      focus.scrollToFocusedColumn();
    }
  }

  private columnMoveRight() {
    const { data, focus } = this;
    if (focus.focusedColumnIndex < data.columns.length - 1) {
      focus.focusedColumnIndex++;
      focus.scrollToFocusedColumn();
    }
  }

  private columnEnterCardFocus(index: number) {
    const { focus } = this;
    if (this.focusedCards.length > 0) {
      focus.focusMode = "card";
      focus.focusedCardIndex = index;
    }
  }

  private async columnReorder(direction: -1 | 1) {
    const { data, focus } = this;
    const column = this.focusedColumn;
    const targetIndex = focus.focusedColumnIndex + direction;
    const inBounds =
      direction < 0
        ? focus.focusedColumnIndex > 0
        : focus.focusedColumnIndex < data.columns.length - 1;
    if (inBounds && column) {
      if (await data.moveColumn(column.id, targetIndex)) {
        focus.focusedColumnIndex = targetIndex;
        focus.scrollToFocusedColumn();
      }
    }
  }

  private async columnCreateCard() {
    const { data, focus } = this;
    const column = this.focusedColumn;
    if (column) {
      const card = await data.createCard(column.id);
      if (card) focus.editingCardId = card.id;
    }
  }

  private async columnCreateColumn() {
    const { data, focus } = this;
    const col = await data.createColumnAtPosition(focus.focusedColumnIndex + 1);
    if (col) {
      focus.focusedColumnIndex = data.columns.findIndex((c) => c.id === col.id);
      if (focus.focusedColumnIndex === -1) focus.focusedColumnIndex = 0;
      focus.scrollToFocusedColumn();
    }
  }

  private async columnDelete() {
    const { data, focus } = this;
    const column = this.focusedColumn;
    if (column) {
      if (await data.deleteColumn(column.id)) {
        focus.focusedColumnIndex = Math.min(
          focus.focusedColumnIndex,
          Math.max(0, data.columns.length - 1),
        );
        focus.scrollToFocusedColumn();
      }
    }
  }

  // ============================================
  // Card focus actions
  // ============================================

  async executeCardAction(action: string, _param?: string) {
    switch (action) {
      case "moveDown":
        this.cardMove(1);
        break;
      case "moveUp":
        this.cardMove(-1);
        break;
      case "moveLeft":
        this.cardMoveColumn(-1);
        break;
      case "moveRight":
        this.cardMoveColumn(1);
        break;
      case "goFirst":
        this.focus.focusedCardIndex = 0;
        break;
      case "goLast":
        this.focus.focusedCardIndex = this.focusedCards.length - 1;
        break;
      case "scrollHalfPageUp":
        this.cardScrollHalfPage(-1);
        break;
      case "scrollHalfPageDown":
        this.cardScrollHalfPage(1);
        break;
      case "exitToColumn":
        this.focus.focusMode = "column";
        break;
      case "moveCardLeft":
        await this.cardMoveToAdjacentColumn(-1);
        break;
      case "moveCardRight":
        await this.cardMoveToAdjacentColumn(1);
        break;
      case "reorderCardDown":
        await this.cardReorder(1);
        break;
      case "reorderCardUp":
        await this.cardReorder(-1);
        break;
      case "startEdit":
        this.cardStartEdit();
        break;
      case "createCardBelow":
        await this.cardCreate(this.focus.focusedCardIndex + 1);
        break;
      case "createCardAbove":
        await this.cardCreate(this.focus.focusedCardIndex);
        break;
      case "deleteCard":
        await this.cardDelete();
        break;
      case "copyCard":
        this.cardCopy();
        break;
      case "pasteBelow":
        await this.cardPasteBelow();
        break;
      case "pasteAbove":
        await this.cardPasteAbove();
        break;
      case "scoreUp":
        await this.cardScore(1);
        break;
      case "scoreDown":
        await this.cardScore(-1);
        break;
    }
  }

  private cardMove(direction: -1 | 1) {
    const { focus } = this;
    const cards = this.focusedCards;
    if (direction > 0) {
      if (focus.focusedCardIndex < cards.length - 1) focus.focusedCardIndex++;
    } else if (focus.focusedCardIndex > 0) {
      focus.focusedCardIndex--;
    }
  }

  private cardMoveColumn(direction: -1 | 1) {
    const { data, focus } = this;
    const inBounds =
      direction < 0
        ? focus.focusedColumnIndex > 0
        : focus.focusedColumnIndex < data.columns.length - 1;
    if (inBounds) {
      focus.saveCurrentCardIndex();
      focus.focusedColumnIndex += direction;
      focus.restoreCardIndex();
      // Empty destination column has no card to focus — drop to column mode,
      // matching jumpToColumn / selectColumnFromPalette.
      if (this.focusedCards.length === 0) focus.focusMode = "column";
      focus.scrollToFocusedColumn();
    }
  }

  private cardScrollHalfPage(direction: -1 | 1) {
    const { focus } = this;
    const cards = this.focusedCards;
    if (direction < 0) {
      focus.focusedCardIndex = Math.max(
        0,
        focus.focusedCardIndex - HALF_PAGE_SIZE,
      );
    } else {
      focus.focusedCardIndex = Math.min(
        cards.length - 1,
        focus.focusedCardIndex + HALF_PAGE_SIZE,
      );
    }
  }

  private async cardMoveToAdjacentColumn(direction: -1 | 1) {
    const { data, focus } = this;
    const card = this.focusedCard;
    const inBounds =
      direction < 0
        ? focus.focusedColumnIndex > 0
        : focus.focusedColumnIndex < data.columns.length - 1;
    if (inBounds && card) {
      const targetColumn = data.columns[focus.focusedColumnIndex + direction];
      if (await data.moveCardToColumn(card.id, targetColumn.id)) {
        focus.focusedColumnIndex += direction;
        const newCards = data.cardsByColumn[targetColumn.id] ?? [];
        focus.focusedCardIndex = newCards.length - 1;
        focus.scrollToFocusedColumn();
      }
    }
  }

  private async cardReorder(direction: -1 | 1) {
    const { focus, data } = this;
    const card = this.focusedCard;
    const cards = this.focusedCards;
    const targetIndex = focus.focusedCardIndex + direction;
    const inBounds =
      direction > 0
        ? focus.focusedCardIndex < cards.length - 1
        : focus.focusedCardIndex > 0;
    if (inBounds && card) {
      if (await data.moveCard(card.id, targetIndex)) {
        focus.focusedCardIndex = targetIndex;
      }
    }
  }

  private cardStartEdit() {
    const card = this.focusedCard;
    if (card) this.focus.startEdit(card.id);
  }

  private async cardCreate(position: number) {
    const { data, focus } = this;
    const column = this.focusedColumn;
    if (column) {
      const newCard = await data.createCard(column.id, "", position);
      if (newCard) {
        const updated = data.cardsByColumn[column.id] ?? [];
        focus.focusedCardIndex = updated.findIndex((c) => c.id === newCard.id);
        if (focus.focusedCardIndex === -1) focus.focusedCardIndex = 0;
        focus.startEdit(newCard.id);
      }
    }
  }

  private async cardDelete() {
    const { data, focus } = this;
    const column = this.focusedColumn;
    const card = this.focusedCard;
    if (card) {
      if (await data.deleteCard(card.id)) {
        const updated = data.cardsByColumn[column.id] ?? [];
        focus.focusedCardIndex = Math.min(
          focus.focusedCardIndex,
          Math.max(0, updated.length - 1),
        );
        if (updated.length === 0) focus.focusMode = "column";
      }
    }
  }

  private cardCopy() {
    const card = this.focusedCard;
    if (card) this.focus.clipboardCard = { ...card };
  }

  private async cardPasteBelow() {
    const { data, focus } = this;
    const column = this.focusedColumn;
    if (focus.clipboardCard && column) {
      const pasted = await data.createCard(
        column.id,
        focus.clipboardCard.content,
        focus.focusedCardIndex + 1,
      );
      if (pasted) focus.focusedCardIndex++;
    }
  }

  private async cardPasteAbove() {
    const { data, focus } = this;
    const column = this.focusedColumn;
    if (focus.clipboardCard && column) {
      await data.createCard(
        column.id,
        focus.clipboardCard.content,
        focus.focusedCardIndex,
      );
    }
  }

  private async cardScore(delta: 1 | -1) {
    const card = this.focusedCard;
    if (card) await this.data.updateCardScore(card.id, delta);
  }

  // ============================================
  // Shared actions
  // ============================================

  private jumpToColumn(param?: string) {
    if (param === undefined) return;
    const { data, focus } = this;
    const targetIndex = Number.parseInt(param, 10);
    if (targetIndex < 0 || targetIndex >= data.columns.length) return;
    if (targetIndex === focus.focusedColumnIndex) return;

    if (focus.focusMode === "card") {
      focus.saveCurrentCardIndex();
    }
    focus.focusedColumnIndex = targetIndex;
    if (focus.focusMode === "card") {
      focus.restoreCardIndex();
      const cards = data.cardsByColumn[data.columns[targetIndex].id] ?? [];
      if (cards.length === 0) focus.focusMode = "column";
    }
    focus.scrollToFocusedColumn();
  }

  // ============================================
  // Command palette
  // ============================================

  executeCommand(action: string) {
    this.focus.closePalette();
    switch (action) {
      case "newDeck":
        this.data.createDeck();
        break;
      case "restoreOnboarding":
        this.data.restoreOnboardingDeck();
        break;
      case "switchDeck":
        this.focus.openPalette("deck");
        break;
      case "renameDeck":
        this.onRenameDeck?.();
        break;
      case "deleteDeck":
        this.onDeleteDeck?.();
        break;
      case "newColumn":
        this.data.createColumn();
        break;
      case "renameColumn":
        this.onRenameColumn?.();
        break;
      case "deleteColumn":
        this.onDeleteColumn?.();
        break;
      case "showShortcuts":
        this.focus.showCheatsheet = true;
        break;
      default:
        this.executeAction(action);
        break;
    }
  }

  // ============================================
  // Deck palette
  // ============================================

  selectDeckFromPalette(deckId: string) {
    this.focus.closePalette();
    const deck = this.data.decks.find((d) => d.id === deckId);
    if (deck && deck.id !== this.data.currentDeck?.id) {
      // Focus indices and mode are restored from persisted state via the
      // setCurrentDeck/clampToLoadedDeck effects in +page.svelte.
      this.data.selectDeck(deck);
    }
  }

  // ============================================
  // Column palette
  // ============================================

  selectColumnFromPalette(columnIndex: number) {
    const { focus, data } = this;
    const wasFocusMode = focus.previousFocusMode;
    focus.closePalette();
    if (columnIndex !== focus.focusedColumnIndex) {
      focus.saveCurrentCardIndex();
      focus.focusedColumnIndex = columnIndex;
      if (wasFocusMode === "card") {
        focus.restoreCardIndex();
        const cards =
          data.cardsByColumn[data.columns[focus.focusedColumnIndex]?.id] ?? [];
        if (cards.length === 0) {
          focus.focusMode = "column";
        }
      }
      focus.scrollToFocusedColumn();
    }
  }

  destroy() {
    this.keyProcessor.destroy();
  }
}
