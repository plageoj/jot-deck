<script lang="ts">
  import type { Column, Card } from "$lib/types";
  import CardComponent from "./Card.svelte";

  interface Props {
    column: Column;
    cards: Card[];
    focused?: boolean;
    focusedCardIndex?: number;
    editingCardId?: string | null;
    renamingColumn?: boolean;
    onAddCard?: () => void;
    onSaveCard?: (cardId: string, content: string) => void;
    onCancelEdit?: () => void;
    onStartEdit?: (cardId: string) => void;
    onExitEdit?: () => void;
    onFocusColumn?: () => void;
    onFocusCard?: (cardIndex: number) => void;
    onRenameColumn?: (name: string) => void;
    onCancelRename?: () => void;
  }

  let {
    column,
    cards,
    focused = false,
    focusedCardIndex = -1,
    editingCardId = null,
    renamingColumn = false,
    onAddCard,
    onSaveCard,
    onCancelEdit,
    onStartEdit,
    onExitEdit,
    onFocusColumn,
    onFocusCard,
    onRenameColumn,
    onCancelRename,
  }: Props = $props();

  let renameInputRef = $state<HTMLInputElement | null>(null);
  let renameValue = $state("");

  // When renaming mode is enabled, set input value and focus
  $effect(() => {
    if (renamingColumn && renameInputRef) {
      renameValue = column.name;
      // Use tick to ensure DOM is updated
      setTimeout(() => {
        renameInputRef?.focus();
        renameInputRef?.select();
      }, 0);
    }
  });

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      onRenameColumn?.(renameValue);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancelRename?.();
    }
  }

  function handleRenameBlur() {
    // Save on blur if name changed
    if (renameValue !== column.name) {
      onRenameColumn?.(renameValue);
    } else {
      onCancelRename?.();
    }
  }

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
    {#if renamingColumn}
      <input
        bind:this={renameInputRef}
        bind:value={renameValue}
        class="column-name-input"
        type="text"
        onkeydown={handleRenameKeydown}
        onblur={handleRenameBlur}
      />
    {:else}
      <span class="column-name">{column.name}</span>
    {/if}
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

  .column-name-input {
    font-size: 0.875rem;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    padding: 0.125rem 0.25rem;
    border: 1px solid var(--accent, #e94560);
    border-radius: 2px;
    background-color: var(--input-bg, #1a1a2e);
    color: var(--text, #eee);
    outline: none;
  }

  .column-name-input:focus {
    box-shadow: 0 0 0 2px var(--accent, #e94560);
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
