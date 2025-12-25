<script lang="ts">
  import type { Column, Card } from "$lib/types";
  import CardComponent from "./Card.svelte";

  interface Props {
    column: Column;
    cards: Card[];
    focused?: boolean;
    focusedCardIndex?: number;
    editingCardId?: string | null;
    onAddCard?: () => void;
    onSaveCard?: (cardId: string, content: string) => void;
    onCancelEdit?: () => void;
    onStartEdit?: (cardId: string) => void;
    onExitEdit?: () => void;
    onFocusColumn?: () => void;
    onFocusCard?: (cardIndex: number) => void;
  }

  let {
    column,
    cards,
    focused = false,
    focusedCardIndex = -1,
    editingCardId = null,
    onAddCard,
    onSaveCard,
    onCancelEdit,
    onStartEdit,
    onExitEdit,
    onFocusColumn,
    onFocusCard,
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
    <span class="column-name">{column.name}</span>
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
          onSave={(content) => onSaveCard?.(card.id, content)}
          {onCancelEdit}
          onStartEdit={() => onStartEdit?.(card.id)}
          {onExitEdit}
          onFocusCard={onFocusCard ? () => onFocusCard(index) : undefined}
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
