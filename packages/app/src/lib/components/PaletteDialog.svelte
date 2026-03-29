<script lang="ts">
  import { onMount } from "svelte";

  export interface PaletteItem {
    id: string;
    label: string;
    shortcut?: string;
    current?: boolean;
  }

  interface Props {
    items: PaletteItem[];
    placeholder: string;
    emptyMessage?: string;
    onSelect: (item: PaletteItem) => void;
    onClose: () => void;
  }

  let {
    items,
    placeholder,
    emptyMessage = "No matching items",
    onSelect,
    onClose,
  }: Props = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let inputRef = $state<HTMLInputElement | null>(null);
  let dialogRef = $state<HTMLDialogElement | null>(null);
  let listRef = $state<HTMLUListElement | null>(null);

  let filteredItems = $derived.by(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return items;
    return items.filter((item) => item.label.toLowerCase().includes(lower));
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
          onSelect(filteredItems[selectedIndex]);
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
  class="palette-dialog"
  aria-label="Palette"
  onclose={onClose}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="palette-panel">
    <input
      bind:this={inputRef}
      bind:value={query}
      class="palette-input"
      type="text"
      {placeholder}
      spellcheck="false"
      autocomplete="off"
    />
    {#if filteredItems.length > 0}
      <ul bind:this={listRef} class="palette-list" role="listbox">
        {#each filteredItems as item, index (item.id)}
          <li
            class="palette-item"
            class:selected={index === selectedIndex}
            role="option"
            aria-selected={index === selectedIndex}
            onclick={() => onSelect(item)}
            onmouseenter={() => (selectedIndex = index)}
          >
            <span class="palette-label" class:current={item.current}
              >{item.label}</span
            >
            {#if item.shortcut}
              <kbd class="palette-shortcut">{item.shortcut}</kbd>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="palette-empty">{emptyMessage}</div>
    {/if}
  </div>
</dialog>

<style>
  .palette-dialog {
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

  .palette-dialog::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
  }

  .palette-panel {
    width: 100%;
    max-width: 500px;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-secondary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    align-self: flex-start;
  }

  .palette-input {
    padding: 0.75rem 1rem;
    border: none;
    border-bottom: 1px solid var(--bg-tertiary);
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.9375rem;
    outline: none;
  }

  .palette-input::placeholder {
    color: var(--text-muted);
  }

  .palette-list {
    list-style: none;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .palette-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .palette-item.selected {
    background-color: var(--bg-tertiary);
  }

  .palette-label {
    color: var(--text);
    font-size: 0.875rem;
  }

  .palette-label.current {
    color: var(--accent);
  }

  .palette-shortcut {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0.125rem 0.5rem;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    border-radius: 3px;
  }

  .palette-empty {
    padding: 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
