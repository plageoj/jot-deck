<script lang="ts" module>
  export interface PaletteItem {
    id: string;
    label: string;
    shortcut?: string;
    current?: boolean;
    /** Optional group heading shown above the first item of a run. */
    section?: string;
    /** Destructive styling (e.g. delete). */
    danger?: boolean;
  }
</script>

<script lang="ts" generics="T extends PaletteItem">
  import { onMount, type Snippet } from "svelte";

  interface Props {
    items: T[];
    placeholder: string;
    emptyMessage?: string;
    onSelect: (item: T) => void;
    onClose: () => void;
    renderItem?: Snippet<[T]>;
    /** Non-navigable content rendered between the input and the list. */
    header?: Snippet;
  }

  let {
    items,
    placeholder,
    emptyMessage = "No matching items",
    onSelect,
    onClose,
    renderItem,
    header,
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
    const el = listRef?.querySelector(`[data-index="${selectedIndex}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
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
      case "Enter": {
        event.preventDefault();
        const item = filteredItems[selectedIndex];
        if (item) onSelect(item);
        break;
      }
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
    {#if header}
      {@render header()}
    {/if}
    {#if filteredItems.length > 0}
      <ul bind:this={listRef} class="palette-list" role="listbox">
        {#each filteredItems as item, index (item.id)}
          {#if item.section && item.section !== filteredItems[index - 1]?.section}
            <li class="palette-section" aria-hidden="true">{item.section}</li>
          {/if}
          <li
            class="palette-item"
            class:selected={index === selectedIndex}
            data-index={index}
            role="option"
            aria-selected={index === selectedIndex}
          >
            <button
              type="button"
              class="palette-item-button"
              class:danger={item.danger}
              tabindex="-1"
              onclick={() => onSelect(item)}
              onmouseenter={() => (selectedIndex = index)}
            >
              {#if renderItem}
                {@render renderItem(item)}
              {:else}
                <span class="palette-label" class:current={item.current}
                  >{item.label}</span
                >
                {#if item.shortcut}
                  <kbd class="palette-shortcut">{item.shortcut}</kbd>
                {/if}
              {/if}
            </button>
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

  .palette-section {
    padding: 0.5rem 1rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .palette-item {
    padding: 0;
  }

  .palette-item.selected {
    background-color: var(--bg-tertiary);
  }

  .palette-item-button {
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

  .palette-item-button:focus {
    outline: none;
  }

  .palette-label {
    color: var(--text);
    font-size: 0.875rem;
  }

  .palette-label.current {
    color: var(--accent);
  }

  .palette-item-button.danger .palette-label {
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
