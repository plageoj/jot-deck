import type { DeckData } from "./deckData.svelte";
import type { FocusManager } from "./focusManager.svelte";
import type { Card, Column } from "./types";

const HALF_PAGE_SIZE = 5;

interface BoardActionContext {
  data: DeckData;
  focus: FocusManager;
  focusedColumn: Column | undefined;
  focusedCards: Card[];
  focusedCard: Card | undefined;
  startEdit: ((cardId: string) => void | Promise<void>) | null;
  renameColumn: (() => void) | null;
  runTask: (task: Promise<unknown>) => void;
}

/** Executes column- and card-focused operations; routing remains with the dispatcher. */
export class BoardActionExecutors {
  constructor(private readonly context: () => BoardActionContext) {}

  async executeColumnAction(action: string): Promise<void> {
    switch (action) {
      case "moveLeft":
        this.columnMove(-1);
        break;
      case "moveRight":
        this.columnMove(1);
        break;
      case "enterCardFocusFirst":
        this.columnEnterCardFocus(0);
        break;
      case "enterCardFocusLast":
        this.columnEnterCardFocus(this.context().focusedCards.length - 1);
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
      case "renameColumn":
        this.context().renameColumn?.();
        break;
    }
  }

  async executeCardAction(action: string): Promise<void> {
    const { focus, focusedCards } = this.context();
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
        focus.focusedCardIndex = 0;
        break;
      case "goLast":
        focus.focusedCardIndex = focusedCards.length - 1;
        break;
      case "scrollHalfPageUp":
        this.cardScrollHalfPage(-1);
        break;
      case "scrollHalfPageDown":
        this.cardScrollHalfPage(1);
        break;
      case "exitToColumn":
        focus.focusMode = "column";
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
      case "renameColumn":
        this.context().renameColumn?.();
        break;
      case "createCardBelow":
        await this.cardCreate(focus.focusedCardIndex + 1);
        break;
      case "createCardAbove":
        await this.cardCreate(focus.focusedCardIndex);
        break;
      case "createColumn":
        if (await this.columnCreateColumn()) {
          focus.focusMode = "column";
        }
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

  private columnMove(direction: -1 | 1): void {
    const { data, focus } = this.context();
    const next = focus.focusedColumnIndex + direction;
    if (next < 0 || next >= data.columns.length) return;
    focus.focusedColumnIndex = next;
    focus.scrollToFocusedColumn();
  }

  private columnEnterCardFocus(index: number): void {
    const { focus, focusedCards } = this.context();
    if (focusedCards.length > 0) {
      focus.focusMode = "card";
      focus.focusedCardIndex = index;
    }
  }

  private async columnReorder(direction: -1 | 1): Promise<void> {
    const { data, focus, focusedColumn } = this.context();
    const targetIndex = focus.focusedColumnIndex + direction;
    const inBounds =
      direction < 0
        ? focus.focusedColumnIndex > 0
        : focus.focusedColumnIndex < data.columns.length - 1;
    if (inBounds && focusedColumn && (await data.moveColumn(focusedColumn.id, targetIndex))) {
      focus.focusedColumnIndex = targetIndex;
      focus.scrollToFocusedColumn();
    }
  }

  private async columnCreateCard(): Promise<void> {
    const { data, focus, focusedColumn, startEdit } = this.context();
    if (!focusedColumn) return;
    const card = await data.createCard(focusedColumn.id);
    if (!card) return;
    const cards = data.cardsByColumn[focusedColumn.id] ?? [];
    focus.focusedCardIndex = cards.findIndex((candidate) => candidate.id === card.id);
    focus.focusMode = "card";
    if (startEdit) await startEdit(card.id);
    else focus.editingCardId = card.id;
  }

  async createColumnFromPalette(): Promise<void> {
    const { data, focus } = this.context();
    const position =
      data.columns.length === 0 ? 0 : focus.focusedColumnIndex + 1;
    const column = await data.createColumnAtPosition(position);
    if (column) this.focusCreatedColumn(column.id);
  }

  private async columnCreateColumn(): Promise<boolean> {
    const { data, focus } = this.context();
    const focusMode = focus.focusMode;
    const focusedColumnIndex = focus.focusedColumnIndex;
    const focusedCardIndex = focus.focusedCardIndex;
    const position = data.columns.length === 0 ? 0 : focus.focusedColumnIndex + 1;
    const column = await data.createColumnAtPosition(position);
    if (!column) return false;
    if (
      focus.focusMode !== focusMode ||
      focus.focusedColumnIndex !== focusedColumnIndex ||
      focus.focusedCardIndex !== focusedCardIndex
    ) {
      return false;
    }
    const index = data.columns.findIndex((candidate) => candidate.id === column.id);
    if (index === -1) return false;
    focus.focusedColumnIndex = index;
    focus.scrollToFocusedColumn();
    return true;
  }

  private focusCreatedColumn(columnId: string): void {
    const { data, focus } = this.context();
    const index = data.columns.findIndex((candidate) => candidate.id === columnId);
    if (index === -1) return;
    focus.focusedColumnIndex = index;
    if ((data.cardsByColumn[columnId] ?? []).length === 0) {
      focus.focusMode = "column";
    }
    focus.scrollToFocusedColumn();
  }

  private async columnDelete(): Promise<void> {
    const { data, focus, focusedColumn } = this.context();
    if (focusedColumn && (await data.deleteColumn(focusedColumn.id))) {
      focus.focusedColumnIndex = Math.min(
        focus.focusedColumnIndex,
        Math.max(0, data.columns.length - 1),
      );
      focus.scrollToFocusedColumn();
    }
  }

  private cardMove(direction: -1 | 1): void {
    const { focus, focusedCards } = this.context();
    if (direction > 0) {
      if (focus.focusedCardIndex < focusedCards.length - 1) focus.focusedCardIndex++;
    } else if (focus.focusedCardIndex > 0) {
      focus.focusedCardIndex--;
    }
  }

  private cardMoveColumn(direction: -1 | 1): void {
    const { data, focus } = this.context();
    const inBounds =
      direction < 0
        ? focus.focusedColumnIndex > 0
        : focus.focusedColumnIndex < data.columns.length - 1;
    if (!inBounds) return;
    focus.saveCurrentCardIndex();
    focus.focusedColumnIndex += direction;
    focus.restoreCardIndex();
    if (this.context().focusedCards.length === 0) focus.focusMode = "column";
    focus.scrollToFocusedColumn();
  }

  private cardScrollHalfPage(direction: -1 | 1): void {
    const { focus, focusedCards } = this.context();
    if (direction < 0) {
      focus.focusedCardIndex = Math.max(0, focus.focusedCardIndex - HALF_PAGE_SIZE);
    } else {
      focus.focusedCardIndex = Math.min(
        focusedCards.length - 1,
        focus.focusedCardIndex + HALF_PAGE_SIZE,
      );
    }
  }

  private async cardMoveToAdjacentColumn(direction: -1 | 1): Promise<void> {
    const { data, focus, focusedCard } = this.context();
    const inBounds =
      direction < 0
        ? focus.focusedColumnIndex > 0
        : focus.focusedColumnIndex < data.columns.length - 1;
    if (!inBounds || !focusedCard) return;
    const targetColumn = data.columns[focus.focusedColumnIndex + direction];
    if (await data.moveCardToColumn(focusedCard.id, targetColumn.id)) {
      focus.focusedColumnIndex += direction;
      const newCards = data.cardsByColumn[targetColumn.id] ?? [];
      focus.focusedCardIndex = newCards.length - 1;
      focus.scrollToFocusedColumn();
    }
  }

  private async cardReorder(direction: -1 | 1): Promise<void> {
    const { focus, data, focusedCard, focusedCards } = this.context();
    const targetIndex = focus.focusedCardIndex + direction;
    const inBounds =
      direction > 0
        ? focus.focusedCardIndex < focusedCards.length - 1
        : focus.focusedCardIndex > 0;
    if (inBounds && focusedCard && (await data.moveCard(focusedCard.id, targetIndex))) {
      focus.focusedCardIndex = targetIndex;
    }
  }

  private cardStartEdit(): void {
    const { data, focus, focusedCard, startEdit, runTask } = this.context();
    if (!focusedCard || data.isStreaming(focusedCard.id)) return;
    if (startEdit) {
      runTask(Promise.resolve().then(() => startEdit(focusedCard.id)));
    } else {
      focus.startEdit(focusedCard.id);
    }
  }

  private async cardCreate(position: number): Promise<void> {
    const { data, focus, focusedColumn, startEdit } = this.context();
    if (!focusedColumn) return;
    const card = await data.createCard(focusedColumn.id, "", position);
    if (!card) return;
    const updated = data.cardsByColumn[focusedColumn.id] ?? [];
    focus.focusedCardIndex = updated.findIndex((candidate) => candidate.id === card.id);
    if (focus.focusedCardIndex === -1) focus.focusedCardIndex = 0;
    focus.focusMode = "card";
    if (startEdit) await startEdit(card.id);
    else focus.startEdit(card.id);
  }

  private async cardDelete(): Promise<void> {
    const { data, focus, focusedColumn, focusedCard } = this.context();
    if (!focusedCard || !(await data.deleteCard(focusedCard.id))) return;
    const updated = data.cardsByColumn[focusedColumn?.id ?? ""] ?? [];
    focus.focusedCardIndex = Math.min(
      focus.focusedCardIndex,
      Math.max(0, updated.length - 1),
    );
    if (updated.length === 0) focus.focusMode = "column";
  }

  private cardCopy(): void {
    const { focus, focusedCard } = this.context();
    if (focusedCard) focus.clipboardCard = { ...focusedCard };
  }

  private async cardPasteBelow(): Promise<void> {
    const { data, focus, focusedColumn } = this.context();
    if (!focus.clipboardCard || !focusedColumn) return;
    const pasted = await data.createCard(
      focusedColumn.id,
      focus.clipboardCard.content,
      focus.focusedCardIndex + 1,
    );
    if (pasted) focus.focusedCardIndex++;
  }

  private async cardPasteAbove(): Promise<void> {
    const { data, focus, focusedColumn } = this.context();
    if (focus.clipboardCard && focusedColumn) {
      await data.createCard(
        focusedColumn.id,
        focus.clipboardCard.content,
        focus.focusedCardIndex,
      );
    }
  }

  private async cardScore(delta: 1 | -1): Promise<void> {
    const { data, focusedCard } = this.context();
    if (focusedCard) await data.updateCardScore(focusedCard.id, delta);
  }
}
