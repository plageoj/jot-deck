<script lang="ts">
  import type { Column, Card } from "$lib/types";
  import PaletteDialog, { type PaletteItem } from "./PaletteDialog.svelte";

  interface Props {
    columns: Column[];
    cardsByColumn: Record<string, Card[]>;
    focusedColumnIndex: number;
    onSelect: (columnIndex: number) => void;
    onNew: () => void;
    onRename: (column: Column) => void;
    onDelete: (column: Column) => void;
    onClose: () => void;
  }

  let {
    columns,
    cardsByColumn,
    focusedColumnIndex,
    onSelect,
    onNew,
    onRename,
    onDelete,
    onClose,
  }: Props = $props();

  type ColumnAction =
    | { kind: "select"; index: number }
    | { kind: "rename"; column: Column }
    | { kind: "delete"; column: Column }
    | { kind: "new" };

  type ColumnPaletteItem = PaletteItem & {
    action: ColumnAction;
    cardCount?: number;
  };

  let currentColumn = $derived(columns[focusedColumnIndex] ?? null);
  let currentCardCount = $derived(
    currentColumn ? (cardsByColumn[currentColumn.id] ?? []).length : 0,
  );

  function shortcutFor(index: number): string | undefined {
    return index < 9 ? `g ${index + 1}` : undefined;
  }

  let items = $derived.by<ColumnPaletteItem[]>(() => {
    const list: ColumnPaletteItem[] = columns
      .map((col, index) => ({ col, index }))
      .filter(({ index }) => index !== focusedColumnIndex)
      .map(({ col, index }) => ({
        id: col.id,
        label: col.name,
        section: "Other columns",
        shortcut: shortcutFor(index),
        cardCount: (cardsByColumn[col.id] ?? []).length,
        action: { kind: "select", index },
      }));

    if (currentColumn) {
      list.push({
        id: "__rename",
        label: "Rename column",
        section: "Actions",
        action: { kind: "rename", column: currentColumn },
      });
      if (columns.length > 1) {
        list.push({
          id: "__delete",
          label: "Delete column",
          section: "Actions",
          danger: true,
          action: { kind: "delete", column: currentColumn },
        });
      }
    }

    list.push({
      id: "__new",
      label: "New column",
      section: "Actions",
      action: { kind: "new" },
    });

    return list;
  });

  function handleSelect(item: ColumnPaletteItem) {
    const action = item.action;
    switch (action.kind) {
      case "select":
        onSelect(action.index);
        break;
      case "rename":
        onRename(action.column);
        break;
      case "delete":
        onDelete(action.column);
        break;
      case "new":
        onNew();
        break;
    }
  }
</script>

<PaletteDialog
  {items}
  placeholder="Switch to column..."
  emptyMessage="No matching columns"
  onSelect={handleSelect}
  {onClose}
  {header}
  {renderItem}
/>

{#snippet header()}
  {#if currentColumn}
    <div class="current-section">
      <span class="current-name">{currentColumn.name}</span>
      <div class="current-stats">
        {currentCardCount}
        {currentCardCount === 1 ? "card" : "cards"}
        {#if shortcutFor(focusedColumnIndex)}
          <span class="current-shortcut">{shortcutFor(focusedColumnIndex)}</span>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet renderItem(item: ColumnPaletteItem)}
  <span class="col-name" class:danger={item.danger}>{item.label}</span>
  <span class="col-meta">
    {#if item.action.kind === "select" && item.cardCount !== undefined}
      {item.cardCount}
      {item.cardCount === 1 ? "card" : "cards"}
    {/if}
    {#if item.shortcut}
      <kbd class="shortcut-hint">{item.shortcut}</kbd>
    {/if}
  </span>
{/snippet}

<style>
  .current-section {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .current-name {
    display: block;
    font-size: 1rem;
    font-weight: 600;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .current-stats {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .current-shortcut {
    font-size: 0.6875rem;
    padding: 0.0625rem 0.375rem;
    border-radius: 3px;
    background-color: var(--bg-tertiary);
    color: var(--text-muted);
    font-family: monospace;
  }

  .col-name {
    font-size: 0.875rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .col-name.danger {
    color: var(--accent);
  }

  .col-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .shortcut-hint {
    font-size: 0.6875rem;
    padding: 0.0625rem 0.375rem;
    border-radius: 3px;
    background-color: var(--bg-tertiary);
    color: var(--text-muted);
    font-family: monospace;
  }
</style>
