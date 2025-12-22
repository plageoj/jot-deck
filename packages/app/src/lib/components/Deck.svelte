<script lang="ts">
  import type { Column, Card } from "$lib/types";
  import ColumnComponent from "./Column.svelte";

  interface Props {
    columns: Column[];
    cardsByColumn: Record<string, Card[]>;
    focusedColumnIndex?: number;
    focusedCardIndex?: number;
    onAddCard?: (columnId: string) => void;
  }

  let {
    columns,
    cardsByColumn,
    focusedColumnIndex = -1,
    focusedCardIndex = -1,
    onAddCard,
  }: Props = $props();

  let deckContainer: HTMLDivElement;

  export function scrollToColumn(index: number) {
    if (deckContainer && columns[index]) {
      const columnElements = deckContainer.querySelectorAll(".column");
      const columnEl = columnElements[index] as HTMLElement;
      if (columnEl) {
        columnEl.scrollIntoView({ behavior: "smooth", inline: "center" });
      }
    }
  }
</script>

<div class="deck" bind:this={deckContainer}>
  {#each columns as column, index (column.id)}
    <ColumnComponent
      {column}
      cards={cardsByColumn[column.id] ?? []}
      focused={index === focusedColumnIndex}
      focusedCardIndex={index === focusedColumnIndex ? focusedCardIndex : -1}
      onAddCard={onAddCard ? () => onAddCard(column.id) : undefined}
    />
  {/each}
</div>

<style>
  .deck {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-behavior: smooth;
    scroll-snap-type: x proximity;
  }

  .deck::-webkit-scrollbar {
    height: 8px;
  }

  .deck::-webkit-scrollbar-track {
    background: var(--scrollbar-track, #1a1a2e);
    border-radius: 4px;
  }

  .deck::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, #0f3460);
    border-radius: 4px;
  }

  .deck::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover, #e94560);
  }
</style>
