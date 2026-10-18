<script lang="ts">
  import type { Column, Card, EditEntry } from "#lib/types.ts";
  import type { EditSession } from "#lib/deckData.svelte.ts";
  import ColumnComponent from "./Column.svelte";

  interface Props {
    columns: Column[];
    cardsByColumn: Record<string, Card[]>;
    focusedColumnIndex?: number;
    focusedCardIndex?: number;
    editingCardId?: string | null;
    editSession?: EditSession | null;
    editEntry?: EditEntry;
    filteredCardIds?: Set<string> | null;
    activeTag?: string | null;
    /** card_id → in-progress streamed text (007 §6.2). */
    streamingText?: Record<string, string>;
    onAddCard?: (columnId: string) => void;
    onRenameColumn?: (column: Column) => void;
    /** The column being renamed in place, with its in-progress name. */
    columnRename?: { columnId: string; draft: string; focusRequest: number } | null;
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
    onFocusColumn?: (columnIndex: number) => void;
    onFocusCard?: (columnIndex: number, cardIndex: number) => void;
    onTagClick?: (tagName: string) => void;
    onTagSuggestions?: (prefix: string) => Promise<{ name: string }[]>;
  }

  let {
    columns,
    cardsByColumn,
    focusedColumnIndex = -1,
    focusedCardIndex = -1,
    editingCardId = null,
    editSession = null,
    editEntry = "start",
    filteredCardIds = null,
    activeTag = null,
    streamingText = {},
    onAddCard,
    onRenameColumn,
    columnRename = null,
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
        columnNumber={index + 1}
        cards={cardsByColumn[column.id] ?? []}
        focused={isCurrentColumn}
        focusedCardIndex={isCurrentColumn ? focusedCardIndex : -1}
        {editingCardId}
        {editSession}
        {editEntry}
        {filteredCardIds}
        {activeTag}
        {streamingText}
        onAddCard={onAddCard ? () => onAddCard(column.id) : undefined}
        onRenameColumn={onRenameColumn ? () => onRenameColumn(column) : undefined}
        renameDraft={columnRename?.columnId === column.id ? columnRename.draft : null}
        renameFocusRequest={columnRename?.columnId === column.id ? columnRename.focusRequest : 0}
        {onRenameDraftChange}
        {onCommitRename}
        {onCancelRename}
        {onSaveCard}
        {onCancelEdit}
        {onStartEdit}
        {onExitEdit}
        {onRegisterExit}
        onFocusColumn={onFocusColumn ? () => onFocusColumn(index) : undefined}
        onFocusCard={onFocusCard ? (cardIndex: number) => onFocusCard(index, cardIndex) : undefined}
        {onTagClick}
        {onTagSuggestions}
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
    /* Apply the user's content font here so columns/cards/CodeMirror
     * inherit it while header, palettes, and dialogs keep the system
     * font. CodeMirror is configured with fontFamily: "inherit". */
    font-family: var(
      --app-font-family,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      Oxygen,
      Ubuntu,
      Cantarell,
      sans-serif
    );
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
