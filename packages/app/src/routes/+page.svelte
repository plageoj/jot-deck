<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    Deck as DeckComponent,
    ColumnPalette,
    CommandPalette,
    KeybindingCheatsheet,
    TagFilterBar,
    TagPalette,
  } from "$lib/components";
  import { DeckData } from "$lib/deckData.svelte";
  import { FocusManager } from "$lib/focusManager.svelte";
  import { ActionDispatcher } from "$lib/actionDispatcher.svelte";
  import "$lib/styles/theme.css";

  const data = new DeckData();
  const focus = new FocusManager(data);
  const actions = new ActionDispatcher(data, focus);

  let deckComponent = $state<DeckComponent | null>(null);

  onMount(async () => {
    focus.onScrollToColumn = (index) => deckComponent?.scrollToColumn(index);
    window.addEventListener("keydown", actions.handleKeydown);
    await data.init();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", actions.handleKeydown);
    actions.destroy();
  });
</script>

<main class="app">
  <header class="header">
    <h1>Jot Deck</h1>
    {#if data.decks.length > 0}
      <select
        value={data.currentDeck?.id}
        onchange={(e) => {
          const deck = data.decks.find((d) => d.id === e.currentTarget.value);
          if (deck) data.selectDeck(deck);
        }}
      >
        {#each data.decks as deck}
          <option value={deck.id}>{deck.name}</option>
        {/each}
      </select>
    {/if}
    <button onclick={() => data.createDeck()}>New Deck</button>
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

{#if focus.showTagPalette}
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
  }

  .header select,
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

  .header select:focus,
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
