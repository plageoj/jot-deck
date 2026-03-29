import type { DeckData } from "./deckData.svelte";
import type { FocusManager } from "./focusManager.svelte";
import { normalizeKey, KeySequenceProcessor } from "./keyProcessor";

const HALF_PAGE_SIZE = 5;

export class ActionDispatcher {
  private data: DeckData;
  private focus: FocusManager;
  private keyProcessor = new KeySequenceProcessor();

  constructor(data: DeckData, focus: FocusManager) {
    this.data = data;
    this.focus = focus;
  }

  // ============================================
  // Keyboard handling
  // ============================================

  handleKeydown = (event: KeyboardEvent) => {
    const { focus, data } = this;

    if (focus.focusMode === "edit") return;

    // Command palette trigger: Ctrl+Shift+P or F1
    if (
      (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") ||
      event.key === "F1"
    ) {
      event.preventDefault();
      focus.openCommandPalette();
      return;
    }

    // Skip if a palette is open (it handles its own keys)
    if (focus.focusMode === "command") return;

    // Block all board shortcuts while cheatsheet is open
    if (focus.showCheatsheet) {
      if (
        event.key === "Escape" ||
        event.key === "?" ||
        (event.shiftKey && event.key === "/") ||
        (event.ctrlKey && event.key === "/")
      ) {
        event.preventDefault();
        focus.showCheatsheet = false;
      }
      return;
    }

    // Skip if focus is on input fields
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    ) {
      return;
    }

    // Cheatsheet trigger: ? or Ctrl+/
    if (
      event.key === "?" ||
      (event.shiftKey && event.key === "/") ||
      (event.ctrlKey && event.key === "/")
    ) {
      event.preventDefault();
      focus.showCheatsheet = !focus.showCheatsheet;
      return;
    }

    // Skip if no columns loaded
    if (data.columns.length === 0) return;

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

  // ============================================
  // Action dispatch
  // ============================================

  async executeAction(action: string) {
    if (action === "showColumnPalette") {
      this.focus.openColumnPalette();
      return;
    }

    if (action === "undo") {
      await this.data.undoLastDelete();
      return;
    }

    const [actionName, param] = action.split(":");

    if (this.focus.focusMode === "column") {
      await this.executeColumnAction(actionName, param);
    } else if (this.focus.focusMode === "card") {
      await this.executeCardAction(actionName, param);
    }
  }

  // ============================================
  // Column focus actions
  // ============================================

  async executeColumnAction(action: string, param?: string) {
    const { data, focus } = this;
    const column = data.columns[focus.focusedColumnIndex];
    const cards = data.cardsByColumn[column?.id] ?? [];

    switch (action) {
      case "moveLeft":
        if (focus.focusedColumnIndex > 0) {
          focus.focusedColumnIndex--;
          focus.scrollToFocusedColumn();
        }
        break;

      case "moveRight":
        if (focus.focusedColumnIndex < data.columns.length - 1) {
          focus.focusedColumnIndex++;
          focus.scrollToFocusedColumn();
        }
        break;

      case "enterCardFocusFirst":
        if (cards.length > 0) {
          focus.focusMode = "card";
          focus.focusedCardIndex = 0;
        }
        break;

      case "enterCardFocusLast":
        if (cards.length > 0) {
          focus.focusMode = "card";
          focus.focusedCardIndex = cards.length - 1;
        }
        break;

      case "reorderColumnLeft":
        if (focus.focusedColumnIndex > 0 && column) {
          if (await data.moveColumn(column.id, focus.focusedColumnIndex - 1)) {
            focus.focusedColumnIndex--;
            focus.scrollToFocusedColumn();
          }
        }
        break;

      case "reorderColumnRight":
        if (focus.focusedColumnIndex < data.columns.length - 1 && column) {
          if (
            await data.moveColumn(column.id, focus.focusedColumnIndex + 1)
          ) {
            focus.focusedColumnIndex++;
            focus.scrollToFocusedColumn();
          }
        }
        break;

      case "createCard":
        if (column) {
          const card = await data.createCard(column.id);
          if (card) focus.editingCardId = card.id;
        }
        break;

      case "createColumn": {
        const col = await data.createColumnAtPosition(
          focus.focusedColumnIndex + 1,
        );
        if (col) {
          focus.focusedColumnIndex = data.columns.findIndex(
            (c) => c.id === col.id,
          );
          if (focus.focusedColumnIndex === -1) focus.focusedColumnIndex = 0;
          focus.scrollToFocusedColumn();
        }
        break;
      }

      case "deleteColumn":
        if (column) {
          if (await data.deleteColumn(column.id)) {
            focus.focusedColumnIndex = Math.min(
              focus.focusedColumnIndex,
              Math.max(0, data.columns.length - 1),
            );
            focus.scrollToFocusedColumn();
          }
        }
        break;

      case "jumpToColumn":
        if (param !== undefined) {
          const targetIndex = parseInt(param, 10);
          if (targetIndex >= 0 && targetIndex < data.columns.length) {
            focus.focusedColumnIndex = targetIndex;
            focus.scrollToFocusedColumn();
          }
        }
        break;
    }
  }

  // ============================================
  // Card focus actions
  // ============================================

  async executeCardAction(action: string, param?: string) {
    const { data, focus } = this;
    const column = data.columns[focus.focusedColumnIndex];
    const cards = data.cardsByColumn[column?.id] ?? [];
    const card = cards[focus.focusedCardIndex];

    switch (action) {
      case "moveDown":
        if (focus.focusedCardIndex < cards.length - 1) {
          focus.focusedCardIndex++;
        }
        break;

      case "moveUp":
        if (focus.focusedCardIndex > 0) {
          focus.focusedCardIndex--;
        }
        break;

      case "moveLeft":
        if (focus.focusedColumnIndex > 0) {
          focus.saveCurrentCardIndex();
          focus.focusedColumnIndex--;
          focus.restoreCardIndex();
          focus.scrollToFocusedColumn();
        }
        break;

      case "moveRight":
        if (focus.focusedColumnIndex < data.columns.length - 1) {
          focus.saveCurrentCardIndex();
          focus.focusedColumnIndex++;
          focus.restoreCardIndex();
          focus.scrollToFocusedColumn();
        }
        break;

      case "goFirst":
        focus.focusedCardIndex = 0;
        break;

      case "goLast":
        focus.focusedCardIndex = cards.length - 1;
        break;

      case "scrollHalfPageUp":
        focus.focusedCardIndex = Math.max(
          0,
          focus.focusedCardIndex - HALF_PAGE_SIZE,
        );
        break;

      case "scrollHalfPageDown":
        focus.focusedCardIndex = Math.min(
          cards.length - 1,
          focus.focusedCardIndex + HALF_PAGE_SIZE,
        );
        break;

      case "exitToColumn":
        focus.focusMode = "column";
        break;

      case "moveCardLeft":
        if (focus.focusedColumnIndex > 0 && card) {
          const targetColumn = data.columns[focus.focusedColumnIndex - 1];
          if (await data.moveCardToColumn(card.id, targetColumn.id)) {
            focus.focusedColumnIndex--;
            const newCards = data.cardsByColumn[targetColumn.id] ?? [];
            focus.focusedCardIndex = newCards.length - 1;
            focus.scrollToFocusedColumn();
          }
        }
        break;

      case "moveCardRight":
        if (focus.focusedColumnIndex < data.columns.length - 1 && card) {
          const targetColumn = data.columns[focus.focusedColumnIndex + 1];
          if (await data.moveCardToColumn(card.id, targetColumn.id)) {
            focus.focusedColumnIndex++;
            const newCards = data.cardsByColumn[targetColumn.id] ?? [];
            focus.focusedCardIndex = newCards.length - 1;
            focus.scrollToFocusedColumn();
          }
        }
        break;

      case "reorderCardDown":
        if (focus.focusedCardIndex < cards.length - 1 && card) {
          if (await data.moveCard(card.id, focus.focusedCardIndex + 1)) {
            focus.focusedCardIndex++;
          }
        }
        break;

      case "reorderCardUp":
        if (focus.focusedCardIndex > 0 && card) {
          if (await data.moveCard(card.id, focus.focusedCardIndex - 1)) {
            focus.focusedCardIndex--;
          }
        }
        break;

      case "startEdit":
        if (card) focus.startEdit(card.id);
        break;

      case "createCardBelow":
        if (column) {
          const newCard = await data.createCard(
            column.id,
            "",
            focus.focusedCardIndex + 1,
          );
          if (newCard) {
            const updated = data.cardsByColumn[column.id] ?? [];
            focus.focusedCardIndex = updated.findIndex(
              (c) => c.id === newCard.id,
            );
            if (focus.focusedCardIndex === -1) focus.focusedCardIndex = 0;
            focus.startEdit(newCard.id);
          }
        }
        break;

      case "createCardAbove":
        if (column) {
          const newCard = await data.createCard(
            column.id,
            "",
            focus.focusedCardIndex,
          );
          if (newCard) {
            const updated = data.cardsByColumn[column.id] ?? [];
            focus.focusedCardIndex = updated.findIndex(
              (c) => c.id === newCard.id,
            );
            if (focus.focusedCardIndex === -1) focus.focusedCardIndex = 0;
            focus.startEdit(newCard.id);
          }
        }
        break;

      case "deleteCard":
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
        break;

      case "copyCard":
        if (card) focus.clipboardCard = { ...card };
        break;

      case "pasteBelow":
        if (focus.clipboardCard && column) {
          const pasted = await data.createCard(
            column.id,
            focus.clipboardCard.content,
            focus.focusedCardIndex + 1,
          );
          if (pasted) focus.focusedCardIndex++;
        }
        break;

      case "pasteAbove":
        if (focus.clipboardCard && column) {
          await data.createCard(
            column.id,
            focus.clipboardCard.content,
            focus.focusedCardIndex,
          );
        }
        break;

      case "scoreUp":
        if (card) await data.updateCardScore(card.id, 1);
        break;

      case "scoreDown":
        if (card) await data.updateCardScore(card.id, -1);
        break;

      case "jumpToColumn":
        if (param !== undefined) {
          const targetIndex = parseInt(param, 10);
          if (
            targetIndex >= 0 &&
            targetIndex < data.columns.length &&
            targetIndex !== focus.focusedColumnIndex
          ) {
            focus.saveCurrentCardIndex();
            focus.focusedColumnIndex = targetIndex;
            focus.restoreCardIndex();
            const newCards =
              data.cardsByColumn[data.columns[focus.focusedColumnIndex].id] ??
              [];
            if (newCards.length === 0) focus.focusMode = "column";
            focus.scrollToFocusedColumn();
          }
        }
        break;

    }
  }

  // ============================================
  // Command palette
  // ============================================

  executeCommand(action: string) {
    this.focus.closeCommandPalette();
    switch (action) {
      case "showColumnPalette":
        this.focus.openColumnPalette();
        break;
      case "newDeck":
        this.data.createDeck();
        break;
      case "newColumn":
        this.data.createColumn();
        break;
      case "deleteColumn":
        this.executeColumnAction("deleteColumn");
        break;
      case "showShortcuts":
        this.focus.showCheatsheet = true;
        break;
    }
  }

  // ============================================
  // Column palette
  // ============================================

  selectColumnFromPalette(columnIndex: number) {
    const { focus, data } = this;
    const wasFocusMode = focus.previousFocusMode;
    focus.closeColumnPalette();
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
