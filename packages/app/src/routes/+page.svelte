<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Deck as DeckComponent,
    ColumnPalette,
    CommandPalette,
    ConfirmDialog,
    DeckSwitcher,
    KeybindingCheatsheet,
    RenameDialog,
    TagFilterBar,
    TagPalette,
  } from "$lib/components";
  import { DeckData } from "$lib/deckData.svelte";
  import { FocusManager } from "$lib/focusManager.svelte";
  import { ActionDispatcher } from "$lib/actionDispatcher.svelte";
  import type { Deck } from "$lib/types";
  import "$lib/styles/theme.css";

  const data = new DeckData();
  const focus = new FocusManager(data);
  const actions = new ActionDispatcher(data, focus);

  let windowTitle = $derived(
    data.currentDeck ? `${data.currentDeck.name} - Jot Deck` : "Jot Deck",
  );

  $effect(() => {
    document.title = windowTitle;
    if ("__TAURI_INTERNALS__" in window) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().setTitle(windowTitle);
      });
    }
  });

  let deckComponent = $state<DeckComponent | null>(null);

  onMount(async () => {
    focus.onScrollToColumn = (index) => deckComponent?.scrollToColumn(index);
    actions.onRenameDeck = () => {
      if (data.currentDeck) handleRenameDeck(data.currentDeck);
    };
    actions.onDeleteDeck = () => {
      if (data.currentDeck) handleDeleteDeck(data.currentDeck);
    };
    window.addEventListener("keydown", actions.handleKeydown);
    await data.init();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", actions.handleKeydown);
    actions.destroy();
  });

  let renamingDeck = $state<Deck | null>(null);
  let deletingDeck = $state<Deck | null>(null);

  function handleRenameDeck(deck: Deck) {
    renamingDeck = deck;
  }

  function handleDeleteDeck(deck: Deck) {
    deletingDeck = deck;
  }

  let totalCardCount = $derived(
    Object.values(data.cardsByColumn).reduce((sum, cards) => sum + cards.length, 0),
  );
</script>

<main class="app">
  <header class="header">
    <h1>{data.currentDeck?.name ?? "Jot Deck"}</h1>
    <button onclick={() => focus.openDeckPalette()} title="Manage Decks (Ctrl+P)"
      >Manage Decks</button
    >
    <button onclick={() => data.createColumn()} disabled={!data.currentDeck}
      >New Column</button
    >
  </header>

  {#if data.activeTagFilter}
    <TagFilterBar
      tagName={data.activeTagFilter}
      onClear={() => data.clearTagFilter()}
    />
  {/if}

  {#if data.loading}
    <div class="status">Loading...</div>
  {:else if data.error}
    <div class="status error">{data.error}</div>
  {:else if !data.currentDeck}
    <div class="status">
      <p>No decks yet. Create your first deck!</p>
      <button onclick={() => data.createDeck()}>Create Deck</button>
    </div>
  {:else if data.columns.length === 0}
    <div class="status">
      <p>No columns in this deck. Create your first column!</p>
      <button onclick={() => data.createColumn()}>Create Column</button>
    </div>
  {:else}
    <DeckComponent
      bind:this={deckComponent}
      columns={data.columns}
      cardsByColumn={data.cardsByColumn}
      focusedColumnIndex={focus.focusedColumnIndex}
      focusedCardIndex={focus.focusMode === "card" ? focus.focusedCardIndex : -1}
      editingCardId={focus.editingCardId}
      onAddCard={async (columnId) => {
        const card = await data.createCard(columnId);
        if (card) focus.editingCardId = card.id;
      }}
      onSaveCard={(cardId, content) => data.saveCard(cardId, content)}
      onCancelEdit={() => focus.cancelEdit()}
      onStartEdit={(cardId) => focus.startEdit(cardId)}
      onExitEdit={() => focus.exitEdit()}
      filteredCardIds={data.filteredCardIds}
      activeTag={data.activeTagFilter}
      onFocusColumn={(i) => focus.handleFocusColumn(i)}
      onFocusCard={(ci, cardi) => focus.handleFocusCard(ci, cardi)}
      onTagClick={(tagName) => data.filterByTag(tagName)}
      onTagSuggestions={(prefix) => data.getTagSuggestions(prefix)}
    />
  {/if}
</main>

{#if focus.showDeckPalette}
  <DeckSwitcher
    currentDeck={data.currentDeck}
    decks={data.decks}
    columnCount={data.columns.length}
    cardCount={totalCardCount}
    onSelect={(deck) => actions.selectDeckFromPalette(deck.id)}
    onNew={() => data.createDeck()}
    onRename={handleRenameDeck}
    onDelete={handleDeleteDeck}
    onClose={() => focus.closeDeckPalette()}
  />
{:else if focus.showTagPalette}
  <TagPalette
    tags={data.deckTags}
    activeTag={data.activeTagFilter}
    onSelect={(tagName) => {
      focus.closeTagPalette();
      data.filterByTag(tagName);
    }}
    onClose={() => focus.closeTagPalette()}
  />
{:else if focus.showColumnPalette}
  <ColumnPalette
    columns={data.columns}
    focusedColumnIndex={focus.focusedColumnIndex}
    onSelect={(i) => actions.selectColumnFromPalette(i)}
    onClose={() => focus.closeColumnPalette()}
  />
{:else if focus.focusMode === "command"}
  <CommandPalette
    onExecute={(action) => actions.executeCommand(action)}
    onClose={() => focus.closeCommandPalette()}
  />
{/if}

{#if renamingDeck}
  <RenameDialog
    title="Rename Deck"
    value={renamingDeck.name}
    onConfirm={(newName) => {
      data.renameDeck(renamingDeck!.id, newName);
      renamingDeck = null;
    }}
    onClose={() => (renamingDeck = null)}
  />
{/if}

{#if deletingDeck}
  <ConfirmDialog
    title="Delete Deck"
    message={`Delete "${deletingDeck.name}"? All columns and cards in this deck will be permanently removed. This cannot be undone.`}
    confirmLabel="Delete"
    onConfirm={() => {
      data.deleteDeck(deletingDeck!.id);
      deletingDeck = null;
    }}
    onClose={() => (deletingDeck = null)}
  />
{/if}

{#if focus.showCheatsheet}
  <KeybindingCheatsheet
    mode={focus.focusMode === "command" ? focus.previousFocusMode : focus.focusMode}
    onClose={() => (focus.showCheatsheet = false)}
  />
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background-color: var(--header-bg);
    border-bottom: 1px solid var(--header-border);
    flex-shrink: 0;
  }

  .header h1 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .header button {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.875rem;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease;
  }

  .header button:focus {
    outline: none;
    border-color: var(--input-border-focus);
  }

  .header button:hover:not(:disabled) {
    background-color: var(--bg-tertiary);
  }

  .header button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 1rem;
    color: var(--text-muted);
  }

  .status.error {
    color: var(--accent);
  }

  .status button {
    padding: 0.5rem 1rem;
    border: 1px solid var(--input-border);
    border-radius: 4px;
    background-color: var(--input-bg);
    color: var(--text);
    font-size: 0.875rem;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .status button:hover {
    background-color: var(--bg-tertiary);
  }
</style>
