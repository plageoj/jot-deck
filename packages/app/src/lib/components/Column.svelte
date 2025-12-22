<script lang="ts">
  import type { Column, Card } from "$lib/types";
  import CardComponent from "./Card.svelte";

  interface Props {
    column: Column;
    cards: Card[];
    focused?: boolean;
    focusedCardIndex?: number;
    onAddCard?: () => void;
  }

  let {
    column,
    cards,
    focused = false,
    focusedCardIndex = -1,
    onAddCard,
  }: Props = $props();

</script>

<div class="column" class:focused>
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
      <CardComponent {card} focused={index === focusedCardIndex} />
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
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    border: 2px solid transparent;
    transition: border-color 0.15s ease;
  }

  .column.focused {
    border-color: var(--column-border-focus, #e94560);
  }

  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background-color: var(--column-header-bg, #0f3460);
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: border-color 0.15s ease;
  }

  .column-header.focused {
    border-bottom-color: var(--accent, #e94560);
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
