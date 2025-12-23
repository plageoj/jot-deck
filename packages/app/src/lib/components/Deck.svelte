<script lang="ts">
  import type { Column, Card } from "$lib/types";
  import ColumnComponent from "./Column.svelte";

  interface Props {
    columns: Column[];
    cardsByColumn: Record<string, Card[]>;
    focusedColumnIndex?: number;
    focusedCardIndex?: number;
    editingCardId?: string | null;
    onAddCard?: (columnId: string) => void;
    onSaveCard?: (cardId: string, content: string) => void;
    onCancelEdit?: () => void;
    onStartEdit?: (cardId: string) => void;
    onExitEdit?: () => void;
    onFocusColumn?: (columnIndex: number) => void;
    onFocusCard?: (columnIndex: number, cardIndex: number) => void;
  }

  let {
    columns,
    cardsByColumn,
    focusedColumnIndex = -1,
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

  let deckContainer: HTMLDivElement;
  let columnRefs: HTMLDivElement[] = [];

  export function scrollToColumn(index: number) {
    const columnEl = columnRefs[index];
    if (columnEl) {
      columnEl.scrollIntoView({ behavior: "smooth", inline: "center" });
    }
  }
</script>

<div class="deck" bind:this={deckContainer}>
  {#each columns as column, index (column.id)}
    {@const isCurrentColumn = index === focusedColumnIndex}
    <div bind:this={columnRefs[index]} class="column-wrapper">
      <ColumnComponent
        {column}
        cards={cardsByColumn[column.id] ?? []}
        focused={isCurrentColumn}
        focusedCardIndex={isCurrentColumn ? focusedCardIndex : -1}
        {editingCardId}
        onAddCard={onAddCard ? () => onAddCard(column.id) : undefined}
        {onSaveCard}
        {onCancelEdit}
        {onStartEdit}
        {onExitEdit}
        onFocusColumn={onFocusColumn ? () => onFocusColumn(index) : undefined}
        onFocusCard={onFocusCard ? (cardIndex: number) => onFocusCard(index, cardIndex) : undefined}
      />
    </div>
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

  .column-wrapper {
    height: 100%;
    flex-shrink: 0;
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
