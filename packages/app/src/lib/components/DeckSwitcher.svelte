<script lang="ts">
  import { onMount } from "svelte";
  import type { Deck } from "$lib/types";

  interface Props {
    currentDeck: Deck | null;
    decks: Deck[];
    columnCount: number;
    cardCount: number;
    onSelect: (deck: Deck) => void;
    onNew: () => void;
    onRename: (deck: Deck) => void;
    onDelete: (deck: Deck) => void;
    onClose: () => void;
  }

  let {
    currentDeck,
    decks,
    columnCount,
    cardCount,
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

  let otherDecks = $derived(decks.filter((d) => d.id !== currentDeck?.id));

  let filteredOtherDecks = $derived.by(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return otherDecks;
    return otherDecks.filter((d) => d.name.toLowerCase().includes(lower));
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
        if (filteredOtherDecks.length > 0) {
          selectedIndex = Math.min(
            selectedIndex + 1,
            filteredOtherDecks.length - 1,
          );
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (filteredOtherDecks.length > 0) {
          selectedIndex = Math.max(selectedIndex - 1, 0);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (filteredOtherDecks.length > 0) {
          onSelect(filteredOtherDecks[selectedIndex]);
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
  class="switcher-dialog"
  aria-label="Deck Switcher"
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
      placeholder="Switch to deck..."
      spellcheck="false"
      autocomplete="off"
    />

    {#if currentDeck}
      <div class="current-section">
        <div class="current-header">
          <span class="current-name">{currentDeck.name}</span>
          <div class="current-actions">
            <button
              class="icon-btn"
              title="Rename Deck"
              onclick={() => {
                dialogRef?.close();
                onRename(currentDeck!);
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
            {#if decks.length > 1}
              <button
                class="icon-btn icon-btn-danger"
                title="Delete Deck"
                onclick={() => {
                  dialogRef?.close();
                  onDelete(currentDeck!);
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
          {columnCount}
          {columnCount === 1 ? "column" : "columns"},
          {cardCount}
          {cardCount === 1 ? "card" : "cards"}
        </div>
      </div>
    {/if}

    {#if filteredOtherDecks.length > 0}
      <div class="other-section">
        <div class="section-label">Other Decks</div>
        <ul bind:this={listRef} class="deck-list" role="listbox">
          {#each filteredOtherDecks as deck, index (deck.id)}
            <li
              class="deck-item"
              class:selected={index === selectedIndex}
              role="option"
              aria-selected={index === selectedIndex}
              onclick={() => onSelect(deck)}
              onmouseenter={() => (selectedIndex = index)}
            >
              <span class="deck-item-name">{deck.name}</span>
            </li>
          {/each}
        </ul>
      </div>
    {:else if query.trim()}
      <div class="empty-message">No matching decks</div>
    {/if}

    <div class="footer-section">
      <button
        class="footer-btn"
        onclick={() => {
          dialogRef?.close();
          onNew();
        }}
      >
        + New Deck
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

  /* Current deck section */
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
  }

  /* Other decks section */
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

  .deck-list {
    list-style: none;
    padding: 0 0 0.25rem;
  }

  .deck-item {
    display: flex;
    align-items: center;
    padding: 0.5rem 1rem;
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .deck-item.selected {
    background-color: var(--bg-tertiary);
  }

  .deck-item-name {
    font-size: 0.875rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
