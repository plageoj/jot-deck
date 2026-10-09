import type { DeckData } from "./deckData.svelte";
import type { FocusManager } from "./focusManager.svelte";
import type { Card, Column } from "./types";
import { findAction } from "./keybindings";
import { normalizeKey, KeySequenceProcessor } from "./keyProcessor";
import { updaterStore } from "./updater.svelte";
import { executeGlobalAction } from "./actionDispatchHelpers";
import { BoardActionExecutors } from "./boardActionExecutors";

export class ActionDispatcher {
  private readonly data: DeckData;
  private readonly focus: FocusManager;
  private readonly keyProcessor = new KeySequenceProcessor();
  private readonly boardActions: BoardActionExecutors;

  // Callbacks for actions that require UI interaction
  onRenameDeck: (() => void) | null = null;
  onDeleteDeck: (() => void) | null = null;
  onRenameColumn: (() => void) | null = null;
  onDeleteColumn: (() => void) | null = null;
  onStartEdit: ((cardId: string) => void | Promise<void>) | null = null;

  constructor(data: DeckData, focus: FocusManager) {
    this.data = data;
    this.focus = focus;
    this.boardActions = new BoardActionExecutors(() => ({
      data: this.data,
      focus: this.focus,
      focusedColumn: this.focusedColumn,
      focusedCards: this.focusedCards,
      focusedCard: this.focusedCard,
      startEdit: this.onStartEdit,
      renameColumn: this.onRenameColumn,
      runTask: (task) => this.runTask(task),
    }));
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

    // Settings / keybindings / about / reporters dialogs manage their own input — let them handle keys.
    if (
      focus.showSettings ||
      focus.showKeybindings ||
      focus.showAbout ||
      focus.showReporters
    )
      return;

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
      this.dispatchAction(result.action);
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
      this.dispatchAction(action);
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
      action === "undo" ||
      action === "redo"
    ) {
      event.preventDefault();
      this.dispatchAction(action);
    } else if (action === "createColumn") {
      event.preventDefault();
      this.runTask(this.executeColumnAction("createColumn"));
    }
  }

  // ============================================
  // Action dispatch
  // ============================================

  async executeAction(action: string) {
    if (action === "checkForUpdates") {
      // Surface the result inline in the About dialog, then kick off the
      // check — a manual check that finds nothing is otherwise silent.
      this.focus.showAbout = true;
      void updaterStore.check();
      return;
    }

    const globalAction = executeGlobalAction(action, this.data, this.focus);
    if (globalAction === true) return;
    if (globalAction instanceof Promise && (await globalAction)) return;

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

  private dispatchAction(action: string) {
    this.runTask(this.executeAction(action));
  }

  private runTask(task: Promise<unknown>) {
    void task.catch((error) => {
      this.data.error = `Failed to execute action: ${error}`;
    });
  }

  // ============================================
  // Column focus actions
  // ============================================

  async executeColumnAction(action: string, _param?: string) {
    await this.boardActions.executeColumnAction(action);
  }

  // ============================================
  // Card focus actions
  // ============================================

  async executeCardAction(action: string, _param?: string) {
    await this.boardActions.executeCardAction(action);
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
        this.runTask(this.data.createDeck());
        break;
      case "restoreOnboarding":
        this.runTask(this.data.restoreOnboardingDeck());
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
        this.runTask(this.createColumnFromPalette());
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
        this.dispatchAction(action);
        break;
    }
  }

  private async createColumnFromPalette() {
    await this.boardActions.createColumnFromPalette();
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
