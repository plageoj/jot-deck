<script lang="ts">
  import { onMount } from "svelte";
  import type { Column, Card } from "$lib/types";

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

  let query = $state("");
  let selectedIndex = $state(0);
  let inputRef = $state<HTMLInputElement | null>(null);
  let dialogRef = $state<HTMLDialogElement | null>(null);
  let listRef = $state<HTMLUListElement | null>(null);

  let currentColumn = $derived(columns[focusedColumnIndex] ?? null);
  let currentCardCount = $derived(
    currentColumn ? (cardsByColumn[currentColumn.id] ?? []).length : 0,
  );
  let otherColumns = $derived(
    columns
      .map((col, i) => ({ col, index: i }))
      .filter((_, i) => i !== focusedColumnIndex),
  );

  let filteredOtherColumns = $derived.by(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return otherColumns;
    return otherColumns.filter((c) => c.col.name.toLowerCase().includes(lower));
  });

  onMount(() => {
    dialogRef?.showModal();
    inputRef?.focus();
  });

  $effect(() => {
    query;
    selectedIndex = 0;
  });

  $effect(() => {
    const item = listRef?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  });

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();

    switch (event.key) {
      case "Escape":
        return;
      case "ArrowDown":
        event.preventDefault();
        if (filteredOtherColumns.length > 0) {
          selectedIndex = Math.min(
            selectedIndex + 1,
            filteredOtherColumns.length - 1,
          );
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (filteredOtherColumns.length > 0) {
          selectedIndex = Math.max(selectedIndex - 1, 0);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (filteredOtherColumns.length > 0) {
          onSelect(filteredOtherColumns[selectedIndex].index);
        }
        break;
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) {
      dialogRef?.close();
    }
  }

  function shortcutFor(index: number): string | undefined {
    return index < 9 ? `g ${index + 1}` : undefined;
  }
</script>

<dialog
  bind:this={dialogRef}
  class="switcher-dialog"
  aria-label="Column Switcher"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="switcher-panel">
    <input
      bind:this={inputRef}
      bind:value={query}
      class="switcher-input"
      type="text"
      placeholder="Switch to column..."
      spellcheck="false"
      autocomplete="off"
    />

    {#if currentColumn}
      <div class="current-section">
        <div class="current-header">
          <span class="current-name">{currentColumn.name}</span>
          <div class="current-actions">
            <button
              class="icon-btn"
              title="Rename Column"
              onclick={() => {
                dialogRef?.close();
                onRename(currentColumn!);
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
            {#if columns.length > 1}
              <button
                class="icon-btn icon-btn-danger"
                title="Delete Column"
                onclick={() => {
                  dialogRef?.close();
                  onDelete(currentColumn!);
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            {/if}
          </div>
        </div>
        <div class="current-stats">
          {currentCardCount}
          {currentCardCount === 1 ? "card" : "cards"}
          {#if shortcutFor(focusedColumnIndex)}
            <span class="current-shortcut">{shortcutFor(focusedColumnIndex)}</span>
          {/if}
        </div>
      </div>
    {/if}

    {#if filteredOtherColumns.length > 0}
      <div class="other-section">
        <div class="section-label">Other Columns</div>
        <ul bind:this={listRef} class="column-list" role="listbox">
          {#each filteredOtherColumns as { col, index }, i (col.id)}
            {@const cardCount = (cardsByColumn[col.id] ?? []).length}
            <li
              class="column-item"
              class:selected={i === selectedIndex}
              role="option"
              aria-selected={i === selectedIndex}
            >
              <button
                type="button"
                class="column-item-button"
                tabindex="-1"
                onclick={() => onSelect(index)}
                onmouseenter={() => (selectedIndex = i)}
              >
                <span class="column-item-name">{col.name}</span>
                <span class="column-item-meta">
                  {cardCount} {cardCount === 1 ? "card" : "cards"}
                  {#if shortcutFor(index)}
                    <kbd class="shortcut-hint">{shortcutFor(index)}</kbd>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {:else if query.trim()}
      <div class="empty-message">No matching columns</div>
    {/if}

    <div class="footer-section">
      <button
        class="footer-btn"
        onclick={() => {
          dialogRef?.close();
          onNew();
        }}
      >
        + New Column
      </button>
    </div>
  </div>
</dialog>

<style>
  .switcher-dialog {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .switcher-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .switcher-panel {
    width: 100%;
    max-width: 500px;
    max-height: 480px;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    align-self: flex-start;
  }

  /* Search input */
  .switcher-input {
    padding: 0.75rem 1rem;
    border: none;
    border-bottom: 1px solid var(--bg-tertiary);
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.9375rem;
    outline: none;
  }

  .switcher-input::placeholder {
    color: var(--text-muted);
  }

  /* Current column section */
  .current-section {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .current-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .current-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .current-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;
  }

  .icon-btn:hover {
    color: var(--text);
    background-color: var(--bg-tertiary);
  }

  .icon-btn-danger:hover {
    color: var(--accent);
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

  /* Other columns section */
  .other-section {
    overflow-y: auto;
  }

  .section-label {
    padding: 0.5rem 1rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .column-list {
    list-style: none;
    padding: 0 0 0.25rem;
  }

  .column-item {
    padding: 0;
  }

  .column-item.selected {
    background-color: var(--bg-tertiary);
  }

  .column-item-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .column-item-button:focus {
    outline: none;
  }

  .column-item-name {
    font-size: 0.875rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .column-item-meta {
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

  /* Empty state */
  .empty-message {
    padding: 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  /* Footer */
  .footer-section {
    border-top: 1px solid var(--bg-tertiary);
    padding: 0.25rem;
  }

  .footer-btn {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
    transition:
      background-color 0.1s ease,
      color 0.1s ease;
  }

  .footer-btn:hover {
    background-color: var(--bg-tertiary);
    color: var(--text);
  }
</style>
