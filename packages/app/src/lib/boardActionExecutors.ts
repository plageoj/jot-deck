import type { DeckData } from "./deckData.svelte";
import type { FocusManager } from "./focusManager.svelte";
import type { Card, Column, EditEntry } from "./types";
import { extractLinks, MAX_LINK_HINTS, openExternalUrl } from "./externalLinks";

const HALF_PAGE_SIZE = 5;

interface BoardActionContext {
  data: DeckData;
  focus: FocusManager;
  focusedColumn: Column | undefined;
  focusedCards: Card[];
  focusedCard: Card | undefined;
  startEdit: ((cardId: string, entry?: EditEntry) => void | Promise<void>) | null;
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
        this.cardStartEdit("start");
        break;
      case "startEditAtEnd":
        this.cardStartEdit("end");
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
      case "copyCardText": {
        const { focusedCard } = this.context();
        if (focusedCard) await this.cardCopyText(focusedCard);
        break;
      }
      case "cutCardText": {
        // Capture the card and deck before awaiting the clipboard write: focus
        // may move meanwhile, and the card that was copied is the one to
        // delete. After a deck switch the undo entry would land in the other
        // deck's history, so skip the delete then.
        const { data, focusedCard } = this.context();
        const deckId = data.currentDeck?.id;
        if (!focusedCard || !(await this.cardCopyText(focusedCard))) break;
        if (this.context().data.currentDeck?.id !== deckId) break;
        await this.cardDelete(focusedCard);
        break;
      }
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
      case "openLink":
        await this.cardOpenLink();
        break;
    }
  }

  /** One link opens at once; several show numbered hints to pick from. */
  private async cardOpenLink(): Promise<void> {
    const { focus, focusedCard } = this.context();
    if (!focusedCard) return;
    const links = extractLinks(focusedCard.content).slice(0, MAX_LINK_HINTS);
    if (links.length === 1) {
      await openExternalUrl(links[0].url);
    } else if (links.length > 1) {
      focus.linkHints = { cardId: focusedCard.id, links, typed: "" };
    }
  }

  /** Index one step away from the focused column, wrapping past either end of the deck. */
  private wrappedColumnIndex(direction: -1 | 1): number {
    const { data, focus } = this.context();
    const count = data.columns.length;
    return (focus.focusedColumnIndex + direction + count) % count;
  }

  private columnMove(direction: -1 | 1): void {
    const { data, focus } = this.context();
    if (data.columns.length === 0) return;
    focus.focusedColumnIndex = this.wrappedColumnIndex(direction);
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
    if (!focusedColumn || data.columns.length < 2) return;
    const targetIndex = this.wrappedColumnIndex(direction);
    if (await data.moveColumn(focusedColumn.id, targetIndex)) {
      focus.focusedColumnIndex = targetIndex;
      focus.scrollToFocusedColumn();
    }
  }

  private async columnCreateCard(): Promise<void> {
    const { data, focus, focusedColumn, startEdit } = this.context();
    if (!focusedColumn) return;
    const previousMode = focus.focusMode === "card" ? "card" : "column";
    const previousCardIndex = focus.focusedCardIndex;
    const card = await data.createNewCard(focusedColumn.id);
    if (!card) return;
    focus.rememberFocusBeforeNewCard(card.id, previousMode, previousCardIndex);
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

  /** Index one step away from the focused card, wrapping past either end of the column. */
  private wrappedCardIndex(direction: -1 | 1): number {
    const { focus, focusedCards } = this.context();
    const count = focusedCards.length;
    return (focus.focusedCardIndex + direction + count) % count;
  }

  private cardMove(direction: -1 | 1): void {
    const { focus, focusedCards } = this.context();
    if (focusedCards.length === 0) return;
    focus.focusedCardIndex = this.wrappedCardIndex(direction);
  }

  private cardMoveColumn(direction: -1 | 1): void {
    const { data, focus } = this.context();
    if (data.columns.length < 2) return;
    focus.saveCurrentCardIndex();
    focus.focusedColumnIndex = this.wrappedColumnIndex(direction);
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
    if (!focusedCard || data.columns.length < 2) return;
    const targetIndex = this.wrappedColumnIndex(direction);
    const targetColumn = data.columns[targetIndex];
    if (await data.moveCardToColumn(focusedCard.id, targetColumn.id)) {
      focus.focusedColumnIndex = targetIndex;
      const newCards = data.cardsByColumn[targetColumn.id] ?? [];
      focus.focusedCardIndex = newCards.length - 1;
      focus.scrollToFocusedColumn();
    }
  }

  private async cardReorder(direction: -1 | 1): Promise<void> {
    const { focus, data, focusedCard, focusedCards } = this.context();
    if (!focusedCard || focusedCards.length < 2) return;
    const targetIndex = this.wrappedCardIndex(direction);
    if (await data.moveCard(focusedCard.id, targetIndex)) {
      focus.focusedCardIndex = targetIndex;
    }
  }

  private cardStartEdit(entry: EditEntry): void {
    const { data, focus, focusedCard, startEdit, runTask } = this.context();
    if (!focusedCard || data.isStreaming(focusedCard.id)) return;
    if (startEdit) {
      runTask(Promise.resolve().then(() => startEdit(focusedCard.id, entry)));
    } else {
      focus.startEdit(focusedCard.id);
    }
  }

  private async cardCreate(position: number): Promise<void> {
    const { data, focus, focusedColumn, startEdit } = this.context();
    if (!focusedColumn) return;
    const previousCardIndex = focus.focusedCardIndex;
    const card = await data.createNewCard(focusedColumn.id, position);
    if (!card) return;
    focus.rememberFocusBeforeNewCard(card.id, "card", previousCardIndex);
    const updated = data.cardsByColumn[focusedColumn.id] ?? [];
    focus.focusedCardIndex = updated.findIndex((candidate) => candidate.id === card.id);
    if (focus.focusedCardIndex === -1) focus.focusedCardIndex = 0;
    focus.focusMode = "card";
    if (startEdit) await startEdit(card.id);
    else focus.startEdit(card.id);
  }

  private async cardDelete(card = this.context().focusedCard): Promise<void> {
    const { data, focusedCard: focusedBefore } = this.context();
    if (!card || !(await data.deleteCard(card.id))) return;
    // Resolve focus against the board as it is now, after the awaited delete.
    // If another card is focused (focus moved during an async cut), keep it
    // focused even though deleting a card above it shifted its index.
    const { focus, focusedColumn } = this.context();
    const updated = data.cardsByColumn[focusedColumn?.id ?? ""] ?? [];
    const kept =
      focusedBefore && focusedBefore.id !== card.id
        ? updated.findIndex((candidate) => candidate.id === focusedBefore.id)
        : -1;
    focus.focusedCardIndex =
      kept !== -1
        ? kept
        : Math.min(focus.focusedCardIndex, Math.max(0, updated.length - 1));
    if (updated.length === 0) focus.focusMode = "column";
  }

  private cardCopy(): void {
    const { focus, focusedCard } = this.context();
    if (focusedCard) focus.clipboardCard = { ...focusedCard };
  }

  /** Writes the card's text to the system clipboard; false if the write failed. */
  private async cardCopyText(card: Card): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(card.content);
      return true;
    } catch {
      // Clipboard unavailable (e.g. permissions): keep the card, and say so —
      // the keydown was consumed, so no native copy ran either.
      this.context().data.error = "Failed to copy card text to the clipboard";
      return false;
    }
  }

  private async cardPasteBelow(): Promise<void> {
    const { focus } = this.context();
    if (focus.clipboardCard) await this.insertCardBelow(focus.clipboardCard.content);
  }

  /** Pastes system clipboard text as a single card below the focused card. */
  async pasteTextBelow(text: string): Promise<void> {
    const normalized = text.replace(/\r\n?/g, "\n");
    // Strip leading/trailing blank lines with a linear scan; `/\n+$/` backtracks
    // quadratically on long newline runs in large pastes.
    let start = 0;
    let end = normalized.length;
    while (start < end && normalized[start] === "\n") start++;
    while (end > start && normalized[end - 1] === "\n") end--;
    const content = normalized.slice(start, end);
    if (content.trim()) await this.insertCardBelow(content);
  }

  private async insertCardBelow(content: string): Promise<void> {
    const { data, focus, focusedColumn } = this.context();
    if (!focusedColumn) return;
    const pasted = await data.createCard(focusedColumn.id, content, focus.focusedCardIndex + 1);
    if (!pasted) return;
    // Focus the pasted card by id: focus may have moved during the write. If
    // the user left the column meanwhile, leave their focus alone.
    if (data.columns[focus.focusedColumnIndex]?.id !== focusedColumn.id) return;
    const cards = data.cardsByColumn[focusedColumn.id] ?? [];
    const index = cards.findIndex((card) => card.id === pasted.id);
    if (index !== -1) focus.focusedCardIndex = index;
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
