<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import type { Deck, Column, Card } from "$lib/types";
  import { Deck as DeckComponent } from "$lib/components";
  import "$lib/styles/theme.css";

  let decks = $state<Deck[]>([]);
  let currentDeck = $state<Deck | null>(null);
  let columns = $state<Column[]>([]);
  let cardsByColumn = $state<Record<string, Card[]>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    await loadDecks();
  });

  async function loadDecks() {
    try {
      loading = true;
      error = null;
      decks = await invoke<Deck[]>("get_all_decks");
      if (decks.length > 0) {
        await selectDeck(decks[0]);
      }
    } catch (e) {
      error = `Failed to load decks: ${e}`;
    } finally {
      loading = false;
    }
  }

  async function selectDeck(deck: Deck) {
    currentDeck = deck;
    try {
      columns = await invoke<Column[]>("get_columns_by_deck", { deckId: deck.id });
      await loadCardsForColumns();
    } catch (e) {
      error = `Failed to load columns: ${e}`;
    }
  }

  async function loadCardsForColumns() {
    const newCardsByColumn: Record<string, Card[]> = {};
    for (const col of columns) {
      try {
        newCardsByColumn[col.id] = await invoke<Card[]>("get_cards_by_column", {
          columnId: col.id,
        });
      } catch (e) {
        console.error(`Failed to load cards for column ${col.id}:`, e);
        newCardsByColumn[col.id] = [];
      }
    }
    cardsByColumn = newCardsByColumn;
  }

  async function createDeck() {
    try {
      const deck = await invoke<Deck>("create_deck", {
        params: { name: "New Deck" },
      });
      decks = [deck, ...decks];
      await selectDeck(deck);
    } catch (e) {
      error = `Failed to create deck: ${e}`;
    }
  }

  async function createColumn() {
    if (!currentDeck) return;
    try {
      const col = await invoke<Column>("create_column", {
        params: { deck_id: currentDeck.id },
      });
      columns = [...columns, col];
      cardsByColumn[col.id] = [];
    } catch (e) {
      error = `Failed to create column: ${e}`;
    }
  }

  async function createCard(columnId: string) {
    try {
      const card = await invoke<Card>("create_card", {
        params: { column_id: columnId, content: "" },
      });
      cardsByColumn[columnId] = [...(cardsByColumn[columnId] || []), card];
    } catch (e) {
      error = `Failed to create card: ${e}`;
    }
  }
</script>

<main class="app">
  <header class="header">
    <h1>Jot Deck</h1>
    {#if decks.length > 0}
      <select
        value={currentDeck?.id}
        onchange={(e) => {
          const deck = decks.find((d) => d.id === e.currentTarget.value);
          if (deck) selectDeck(deck);
        }}
      >
        {#each decks as deck}
          <option value={deck.id}>{deck.name}</option>
        {/each}
      </select>
    {/if}
    <button onclick={createDeck}>New Deck</button>
    <button onclick={createColumn} disabled={!currentDeck}>New Column</button>
  </header>

  {#if loading}
    <div class="status">Loading...</div>
  {:else if error}
    <div class="status error">{error}</div>
  {:else if !currentDeck}
    <div class="status">
      <p>No decks yet. Create your first deck!</p>
      <button onclick={createDeck}>Create Deck</button>
    </div>
  {:else if columns.length === 0}
    <div class="status">
      <p>No columns in this deck. Create your first column!</p>
      <button onclick={createColumn}>Create Column</button>
    </div>
  {:else}
    <DeckComponent {columns} {cardsByColumn} onAddCard={createCard} />
  {/if}
</main>

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
    transition: border-color 0.15s ease, background-color 0.15s ease;
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
