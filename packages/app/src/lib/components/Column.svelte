<script lang="ts">
  import type { Column, Card } from "#lib/types.ts";
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
    filteredCardIds?: Set<string> | null;
    activeTag?: string | null;
    /** card_id → in-progress streamed text for cards receiving a Reporter
     * stream (007 §6.2). Absent keys render normally. */
    streamingText?: Record<string, string>;
    onAddCard?: () => void;
    onSaveCard?: (session: EditSession, content: string, release: boolean) => Promise<boolean>;
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
    filteredCardIds = null,
    activeTag = null,
    streamingText = {},
    onAddCard,
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

<div class="column" class:focused role="button" tabindex="-1" onclick={handleColumnClick} onkeydown={() => {}}>
  <div class="column-header" class:focused>
    <span class="column-title">
      {#if columnNumber !== undefined && columnNumber >= 1 && columnNumber <= 9}
        <kbd class="column-number" title="g {columnNumber}">{columnNumber}</kbd>
      {/if}
      <span class="column-name">{column.name}</span>
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
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }

  .column-header.focused {
    background-color: var(--column-header-bg-focus, #1a4a7a);
    box-shadow: inset 4px 0 0 var(--accent, #e94560);
    padding-left: 0.75rem;
  }

  .column-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .column-number {
    flex-shrink: 0;
    min-width: 1.25rem;
    padding: 0.0625rem 0.3125rem;
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    background-color: var(--bg-primary);
    color: var(--text-muted);
    font-family: monospace;
    font-size: 0.6875rem;
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
