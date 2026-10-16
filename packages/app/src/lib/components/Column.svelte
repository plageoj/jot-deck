<script lang="ts">
  import type { Column, Card, EditEntry } from "#lib/types.ts";
  import type { EditSession } from "#lib/deckData.svelte.ts";
  import CardComponent from "./Card.svelte";

  interface Props {
    column: Column;
    /** 1-based position in the Deck; shown as a `g n` jump hint for 1–9. */
    columnNumber?: number;
    cards: Card[];
    focused?: boolean;
    focusedCardIndex?: number;
    editingCardId?: string | null;
    editSession?: EditSession | null;
    editEntry?: EditEntry;
    filteredCardIds?: Set<string> | null;
    activeTag?: string | null;
    /** card_id → in-progress streamed text for cards receiving a Reporter
     * stream (007 §6.2). Absent keys render normally. */
    streamingText?: Record<string, string>;
    onAddCard?: () => void;
    /** Double-clicking the header starts renaming the column. */
    onRenameColumn?: () => void;
    /** In-progress name while the header is being renamed in place; `null`
     * when not renaming. Like a card editor, it survives losing focus. */
    renameDraft?: string | null;
    /** Bumped on each rename request so the input takes focus again. */
    renameFocusRequest?: number;
    onRenameDraftChange?: (draft: string) => void;
    onCommitRename?: () => void;
    onCancelRename?: () => void;
    onSaveCard?: (
      session: EditSession,
      content: string,
      release: boolean,
      cursor: number,
    ) => Promise<boolean>;
    onCancelEdit?: (session: EditSession) => Promise<boolean>;
    onStartEdit?: (cardId: string) => void;
    onExitEdit?: (session: EditSession) => void;
    onRegisterExit?: (
      session: EditSession,
      exit: (() => Promise<boolean>) | null,
    ) => void;
    onFocusColumn?: () => void;
    onFocusCard?: (cardIndex: number) => void;
    onTagClick?: (tagName: string) => void;
    onTagSuggestions?: (prefix: string) => Promise<{ name: string }[]>;
  }

  let {
    column,
    columnNumber,
    cards,
    focused = false,
    focusedCardIndex = -1,
    editingCardId = null,
    editSession = null,
    editEntry = "start",
    filteredCardIds = null,
    activeTag = null,
    streamingText = {},
    onAddCard,
    onRenameColumn,
    renameDraft = null,
    renameFocusRequest = 0,
    onRenameDraftChange,
    onCommitRename,
    onCancelRename,
    onSaveCard,
    onCancelEdit,
    onStartEdit,
    onExitEdit,
    onRegisterExit,
    onFocusColumn,
    onFocusCard,
    onTagClick,
    onTagSuggestions,
  }: Props = $props();

  function handleColumnClick(e: MouseEvent) {
    // Only handle clicks directly on the column or header, not on cards
    const target = e.target as HTMLElement;
    if (target.closest(".cards")) return;
    onFocusColumn?.();
  }

  function handleColumnDblClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".column-header") || target.closest("button, input")) return;
    onRenameColumn?.();
  }

  let renameInput = $state<HTMLInputElement | null>(null);
  let selectedRenameInput: HTMLInputElement | null = null;

  // Select the whole name when the input first appears; later requests (e.g.
  // `r` after clicking away) only refocus, keeping the caret where it was.
  $effect(() => {
    void renameFocusRequest;
    if (!renameInput) return;
    renameInput.focus();
    if (selectedRenameInput !== renameInput) {
      renameInput.select();
      selectedRenameInput = renameInput;
    }
  });

  function handleRenameKeydown(e: KeyboardEvent) {
    // Enter that confirms an IME composition must not commit the rename.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onCommitRename?.();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancelRename?.();
    }
  }

  let cardRefs: HTMLDivElement[] = [];

  // Scroll to focused card when focusedCardIndex changes
  $effect(() => {
    if (focusedCardIndex >= 0 && cardRefs[focusedCardIndex]) {
      cardRefs[focusedCardIndex].scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  });
</script>

<div class="column" class:focused role="button" tabindex="-1" onclick={handleColumnClick} ondblclick={handleColumnDblClick} onkeydown={() => {}}>
  <div class="column-header" class:focused>
    <span class="column-title">
      {#if columnNumber !== undefined && columnNumber >= 1 && columnNumber <= 9}
        <kbd class="column-number" title="g {columnNumber}: Focus this column">{columnNumber}</kbd>
      {/if}
      {#if renameDraft !== null}
        <input
          bind:this={renameInput}
          class="column-name-input"
          type="text"
          value={renameDraft}
          aria-label="Column name"
          spellcheck="false"
          autocomplete="off"
          oninput={(e) => onRenameDraftChange?.(e.currentTarget.value)}
          onkeydown={handleRenameKeydown}
        />
      {:else}
        <span class="column-name">{column.name}</span>
      {/if}
    </span>
    {#if onAddCard}
      <button
        class="add-card"
        onclick={onAddCard}
        aria-label="Add card to {column.name}"
      >
        +
      </button>
    {/if}
  </div>

  <div class="cards">
    {#each cards as card, index (card.id)}
      <div bind:this={cardRefs[index]}>
        <CardComponent
          {card}
          focused={index === focusedCardIndex}
          editing={editingCardId === card.id}
          editSession={editSession?.cardId === card.id ? editSession : null}
          {editEntry}
          dimmed={filteredCardIds !== null && !filteredCardIds.has(card.id)}
          streamingText={streamingText[card.id] ?? null}
          {activeTag}
          onSave={onSaveCard}
          {onCancelEdit}
          onStartEdit={() => onStartEdit?.(card.id)}
          {onExitEdit}
          {onRegisterExit}
          onFocusCard={onFocusCard ? () => onFocusCard(index) : undefined}
          {onTagClick}
          {onTagSuggestions}
        />
      </div>
    {/each}
  </div>
</div>

<style>
  .column {
    display: flex;
    flex-direction: column;
    min-width: 280px;
    max-width: 280px;
    height: 100%;
    background-color: var(--column-bg, #16213e);
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
    outline: none;
  }

  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    padding-left: calc(0.75rem + 4px);
    background-color: var(--column-header-bg, #0f3460);
    font-weight: 500;
    cursor: pointer;
    -webkit-user-select: none;
    user-select: none;
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }

  .column-header.focused {
    background-color: var(--column-header-bg-focus, #1a4a7a);
    box-shadow: inset 4px 0 0 var(--accent, #e94560);
  }

  .column-title {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .column-number {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    background-color: var(--bg-primary);
    color: var(--text-muted);
    font-family: monospace;
    font-size: 0.875rem;
    line-height: 1.4;
    text-align: center;
  }

  .column-header.focused .column-number {
    color: var(--accent, #e94560);
  }

  .column-name {
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .column-name-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: 1.5rem;
    margin-right: 0.5rem;
    padding: 0 0.25rem;
    border: 1px solid var(--accent, #e94560);
    border-radius: 3px;
    background-color: var(--bg-primary);
    color: var(--text, #eee);
    font: inherit;
    font-size: 0.875rem;
    outline: none;
    /* The header disables selection; editing needs it back. */
    -webkit-user-select: text;
    user-select: text;
  }

  .add-card {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background-color: var(--card-bg, #1a1a2e);
    color: var(--text, #eee);
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background-color 0.15s ease;
  }

  .add-card:hover {
    background-color: var(--accent, #e94560);
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    flex: 1;
    overflow-y: auto;
  }
</style>
