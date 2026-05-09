<script lang="ts">
  import { onMount } from "svelte";
  import type { TrashItem } from "$lib/types";

  interface Props {
    items: TrashItem[];
    onRestore: (item: TrashItem) => void;
    onClose: () => void;
  }

  let { items, onRestore, onClose }: Props = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let inputRef = $state<HTMLInputElement | null>(null);
  let dialogRef = $state<HTMLDialogElement | null>(null);
  let listRef = $state<HTMLUListElement | null>(null);

  let filteredItems = $derived.by(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return items;
    return items.filter((item) => previewLabel(item).toLowerCase().includes(lower));
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

  function previewLabel(item: TrashItem): string {
    if (item.type === "column") return item.column.name;
    const firstLine = item.card.content.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 0 ? firstLine : "(empty card)";
  }

  function relativeTime(iso: string): string {
    if (!iso) return "";
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return "";
    const diffMs = Date.now() - then;
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    return `${day}d ago`;
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();

    switch (event.key) {
      case "Escape":
        return;
      case "ArrowDown":
        event.preventDefault();
        if (filteredItems.length > 0) {
          selectedIndex = Math.min(selectedIndex + 1, filteredItems.length - 1);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (filteredItems.length > 0) {
          selectedIndex = Math.max(selectedIndex - 1, 0);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (filteredItems.length > 0) {
          onRestore(filteredItems[selectedIndex]);
        }
        break;
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogRef) {
      dialogRef?.close();
    }
  }
</script>

<dialog
  bind:this={dialogRef}
  class="trash-dialog"
  aria-label="Trash"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="trash-panel">
    <input
      bind:this={inputRef}
      bind:value={query}
      class="trash-input"
      type="text"
      placeholder="Search trash..."
      spellcheck="false"
      autocomplete="off"
    />
    <div class="trash-hint">
      Restore deleted items. Press <kbd>Enter</kbd> to restore the selected item.
    </div>
    {#if filteredItems.length > 0}
      <ul bind:this={listRef} class="trash-list" role="listbox">
        {#each filteredItems as item, index (item.id)}
          <li
            class="trash-item"
            class:selected={index === selectedIndex}
            role="option"
            aria-selected={index === selectedIndex}
          >
            <button
              type="button"
              class="trash-item-button"
              tabindex="-1"
              onclick={() => onRestore(item)}
              onmouseenter={() => (selectedIndex = index)}
            >
              <div class="trash-item-main">
                <span class="trash-type-badge" class:column={item.type === "column"}>
                  {item.type === "column" ? "Col" : "Card"}
                </span>
                <span class="trash-label">{previewLabel(item)}</span>
              </div>
              <div class="trash-meta">
                {#if item.type === "card" && item.columnName}
                  <span class="trash-column">{item.columnName}</span>
                {/if}
                <span class="trash-time">{relativeTime(item.deletedAt)}</span>
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {:else if items.length === 0}
      <div class="trash-empty">Trash is empty</div>
    {:else}
      <div class="trash-empty">No matching items</div>
    {/if}
  </div>
</dialog>

<style>
  .trash-dialog {
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

  .trash-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .trash-panel {
    width: 100%;
    max-width: 560px;
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

  .trash-input {
    padding: 0.75rem 1rem;
    border: none;
    border-bottom: 1px solid var(--bg-tertiary);
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.9375rem;
    outline: none;
  }

  .trash-input::placeholder {
    color: var(--text-muted);
  }

  .trash-hint {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .trash-hint kbd {
    padding: 0.0625rem 0.375rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.75rem;
  }

  .trash-list {
    list-style: none;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .trash-item {
    padding: 0;
  }

  .trash-item.selected {
    background-color: var(--bg-tertiary);
  }

  .trash-item-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
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

  .trash-item-button:focus {
    outline: none;
  }

  .trash-item-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .trash-type-badge {
    flex-shrink: 0;
    padding: 0.0625rem 0.375rem;
    border-radius: 3px;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-family: monospace;
    text-transform: uppercase;
  }

  .trash-type-badge.column {
    color: var(--accent);
    border-color: var(--accent);
  }

  .trash-label {
    color: var(--text);
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .trash-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .trash-column {
    padding: 0.0625rem 0.375rem;
    border-radius: 3px;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trash-empty {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
