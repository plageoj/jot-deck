<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, onDestroy } from "svelte";
  import type { Deck, Column, Card } from "$lib/types";
  import { Deck as DeckComponent } from "$lib/components";
  import { type FocusMode, findAction, isValidPrefix } from "$lib/keybindings";
  import "$lib/styles/theme.css";

  // Data state
  let decks = $state<Deck[]>([]);
  let currentDeck = $state<Deck | null>(null);
  let columns = $state<Column[]>([]);
  let cardsByColumn = $state<Record<string, Card[]>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Focus state
  let focusMode = $state<FocusMode>("card");
  let focusedColumnIndex = $state(0);
  let focusedCardIndex = $state(0);
  let editingCardId = $state<string | null>(null);

  // Remember last focused card index per column
  let lastFocusedCardByColumn = $state<Record<string, number>>({});

  // Clipboard for copy/paste
  let clipboardCard = $state<Card | null>(null);

  // Key sequence state (for dd, yy, gg, g1-g9, etc.)
  let keySequence = $state("");
  let keySequenceTimer: ReturnType<typeof setTimeout> | null = null;
  const SEQUENCE_TIMEOUT = 500;

  // Undo state - stack of deleted items (LIFO)
  interface DeletedItem {
    type: "card" | "column";
    id: string;
  }
  let deletedStack = $state<DeletedItem[]>([]);

  // Deck component reference for scrolling
  let deckComponent = $state<DeckComponent | null>(null);

  onMount(async () => {
    window.addEventListener("keydown", handleKeydown);
    await loadDecks();
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
    if (keySequenceTimer) {
      clearTimeout(keySequenceTimer);
    }
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
      // Start editing the new card immediately
      editingCardId = card.id;
    } catch (e) {
      error = `Failed to create card: ${e}`;
    }
  }

  async function saveCard(cardId: string, content: string) {
    try {
      const updatedCard = await invoke<Card>("update_card_content", {
        id: cardId,
        content,
      });
      // Update the card in the local state
      for (const columnId of Object.keys(cardsByColumn)) {
        const cards = cardsByColumn[columnId];
        const index = cards.findIndex((c) => c.id === cardId);
        if (index !== -1) {
          cardsByColumn[columnId] = [
            ...cards.slice(0, index),
            updatedCard,
            ...cards.slice(index + 1),
          ];
          break;
        }
      }
    } catch (e) {
      error = `Failed to save card: ${e}`;
    }
  }

  function cancelEdit() {
    editingCardId = null;
  }

  function startEdit(cardId: string) {
    editingCardId = cardId;
    focusMode = "edit";
  }

  function exitEdit() {
    editingCardId = null;
    focusMode = "card";
  }

  // ============================================
  // Keyboard handling
  // ============================================

  function handleKeydown(event: KeyboardEvent) {
    // Skip if in edit mode (CodeMirror handles keys)
    if (focusMode === "edit") return;

    // Skip if focus is on input fields
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    ) {
      return;
    }

    // Skip if no columns loaded
    if (columns.length === 0) return;

    const result = processKey(event);
    if (result.handled) {
      event.preventDefault();
    }
  }

  function processKey(event: KeyboardEvent): { handled: boolean } {
    const key = normalizeKey(event);
    if (!key) return { handled: false };

    // Build new sequence
    const newSequence = keySequence + key;

    // Clear existing timer
    if (keySequenceTimer) {
      clearTimeout(keySequenceTimer);
      keySequenceTimer = null;
    }

    // Check for exact match
    const action = findAction(newSequence, focusMode);
    if (action) {
      keySequence = "";
      executeAction(action);
      return { handled: true };
    }

    // Check if it's a valid prefix (more keys expected)
    if (isValidPrefix(newSequence, focusMode)) {
      keySequence = newSequence;
      keySequenceTimer = setTimeout(() => {
        keySequence = "";
      }, SEQUENCE_TIMEOUT);
      return { handled: true };
    }

    // Not a valid sequence, reset and try single key
    keySequence = "";
    const singleAction = findAction(key, focusMode);
    if (singleAction) {
      executeAction(singleAction);
      return { handled: true };
    }

    return { handled: false };
  }

  function normalizeKey(event: KeyboardEvent): string | null {
    // Ignore modifier-only keys
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
      return null;
    }

    // Handle special keys
    if (event.key === "Escape") return "Escape";
    if (event.key === "Enter") return "Enter";
    if (event.key === "Delete") return "Delete";

    // Single character keys (including uppercase via Shift)
    if (event.key.length === 1) {
      return event.key;
    }

    return null;
  }

  async function executeAction(action: string) {
    // Handle parameterized actions (e.g., "jumpToColumn:0")
    const [actionName, param] = action.split(":");

    if (focusMode === "column") {
      await executeColumnAction(actionName, param);
    } else if (focusMode === "card") {
      await executeCardAction(actionName, param);
    }
  }

  // ============================================
  // Column focus actions
  // ============================================

  async function executeColumnAction(action: string, param?: string) {
    const column = columns[focusedColumnIndex];
    const cards = cardsByColumn[column?.id] ?? [];

    switch (action) {
      case "moveLeft":
        if (focusedColumnIndex > 0) {
          focusedColumnIndex--;
          scrollToFocusedColumn();
        }
        break;

      case "moveRight":
        if (focusedColumnIndex < columns.length - 1) {
          focusedColumnIndex++;
          scrollToFocusedColumn();
        }
        break;

      case "enterCardFocusFirst":
        if (cards.length > 0) {
          focusMode = "card";
          focusedCardIndex = 0;
        }
        break;

      case "enterCardFocusLast":
        if (cards.length > 0) {
          focusMode = "card";
          focusedCardIndex = cards.length - 1;
        }
        break;

      case "reorderColumnLeft":
        if (focusedColumnIndex > 0 && column) {
          try {
            await invoke("move_column", {
              id: column.id,
              position: focusedColumnIndex - 1,
            });
            await reloadColumns();
            focusedColumnIndex--;
            scrollToFocusedColumn();
          } catch (e) {
            error = `Failed to move column: ${e}`;
          }
        }
        break;

      case "reorderColumnRight":
        if (focusedColumnIndex < columns.length - 1 && column) {
          try {
            await invoke("move_column", {
              id: column.id,
              position: focusedColumnIndex + 1,
            });
            await reloadColumns();
            focusedColumnIndex++;
            scrollToFocusedColumn();
          } catch (e) {
            error = `Failed to move column: ${e}`;
          }
        }
        break;

      case "createCard":
        if (column) {
          await createCard(column.id);
        }
        break;

      case "createColumn":
        await createColumnAtPosition(focusedColumnIndex + 1);
        break;

      case "deleteColumn":
        if (column) {
          try {
            await invoke("delete_column", { id: column.id });
            deletedStack = [...deletedStack, { type: "column", id: column.id }];
            await reloadColumns();
            focusedColumnIndex = Math.min(focusedColumnIndex, Math.max(0, columns.length - 1));
            scrollToFocusedColumn();
          } catch (e) {
            error = `Failed to delete column: ${e}`;
          }
        }
        break;

      case "jumpToColumn":
        if (param !== undefined) {
          const targetIndex = parseInt(param, 10);
          if (targetIndex >= 0 && targetIndex < columns.length) {
            focusedColumnIndex = targetIndex;
            scrollToFocusedColumn();
          }
        }
        break;

      case "undo":
        await undoLastDelete();
        break;
    }
  }

  // ============================================
  // Card focus actions
  // ============================================

  async function executeCardAction(action: string, param?: string) {
    const column = columns[focusedColumnIndex];
    const cards = cardsByColumn[column?.id] ?? [];
    const card = cards[focusedCardIndex];

    switch (action) {
      case "moveDown":
        if (focusedCardIndex < cards.length - 1) {
          focusedCardIndex++;
        }
        break;

      case "moveUp":
        if (focusedCardIndex > 0) {
          focusedCardIndex--;
        }
        break;

      case "moveLeft":
        if (focusedColumnIndex > 0) {
          saveCurrentCardIndex();
          focusedColumnIndex--;
          restoreCardIndex();
          scrollToFocusedColumn();
        }
        break;

      case "moveRight":
        if (focusedColumnIndex < columns.length - 1) {
          saveCurrentCardIndex();
          focusedColumnIndex++;
          restoreCardIndex();
          scrollToFocusedColumn();
        }
        break;

      case "goFirst":
        focusedCardIndex = 0;
        break;

      case "goLast":
        focusedCardIndex = cards.length - 1;
        break;

      case "exitToColumn":
        focusMode = "column";
        break;

      case "moveCardLeft":
        if (focusedColumnIndex > 0 && card) {
          const targetColumn = columns[focusedColumnIndex - 1];
          try {
            await invoke("move_card_to_column", {
              id: card.id,
              columnId: targetColumn.id,
            });
            await loadCardsForColumns();
            focusedColumnIndex--;
            const newCards = cardsByColumn[targetColumn.id] ?? [];
            focusedCardIndex = newCards.length - 1;
            scrollToFocusedColumn();
          } catch (e) {
            error = `Failed to move card: ${e}`;
          }
        }
        break;

      case "moveCardRight":
        if (focusedColumnIndex < columns.length - 1 && card) {
          const targetColumn = columns[focusedColumnIndex + 1];
          try {
            await invoke("move_card_to_column", {
              id: card.id,
              columnId: targetColumn.id,
            });
            await loadCardsForColumns();
            focusedColumnIndex++;
            const newCards = cardsByColumn[targetColumn.id] ?? [];
            focusedCardIndex = newCards.length - 1;
            scrollToFocusedColumn();
          } catch (e) {
            error = `Failed to move card: ${e}`;
          }
        }
        break;

      case "reorderCardDown":
        if (focusedCardIndex < cards.length - 1 && card) {
          try {
            await invoke("move_card", {
              id: card.id,
              position: focusedCardIndex + 1,
            });
            await loadCardsForColumns();
            focusedCardIndex++;
          } catch (e) {
            error = `Failed to move card: ${e}`;
          }
        }
        break;

      case "reorderCardUp":
        if (focusedCardIndex > 0 && card) {
          try {
            await invoke("move_card", {
              id: card.id,
              position: focusedCardIndex - 1,
            });
            await loadCardsForColumns();
            focusedCardIndex--;
          } catch (e) {
            error = `Failed to move card: ${e}`;
          }
        }
        break;

      case "startEdit":
        if (card) {
          startEdit(card.id);
        }
        break;

      case "createCardBelow":
        if (column) {
          await createCardAtPosition(column.id, focusedCardIndex + 1);
        }
        break;

      case "createCardAbove":
        if (column) {
          await createCardAtPosition(column.id, focusedCardIndex);
        }
        break;

      case "deleteCard":
        if (card) {
          try {
            await invoke("delete_card", { id: card.id });
            deletedStack = [...deletedStack, { type: "card", id: card.id }];
            await loadCardsForColumns();
            const updatedCards = cardsByColumn[column.id] ?? [];
            focusedCardIndex = Math.min(focusedCardIndex, Math.max(0, updatedCards.length - 1));
            if (updatedCards.length === 0) {
              focusMode = "column";
            }
          } catch (e) {
            error = `Failed to delete card: ${e}`;
          }
        }
        break;

      case "copyCard":
        if (card) {
          clipboardCard = { ...card };
        }
        break;

      case "pasteBelow":
        if (clipboardCard && column) {
          try {
            await invoke("create_card", {
              params: {
                column_id: column.id,
                content: clipboardCard.content,
                position: focusedCardIndex + 1,
              },
            });
            await loadCardsForColumns();
            focusedCardIndex++;
          } catch (e) {
            error = `Failed to paste card: ${e}`;
          }
        }
        break;

      case "pasteAbove":
        if (clipboardCard && column) {
          try {
            await invoke("create_card", {
              params: {
                column_id: column.id,
                content: clipboardCard.content,
                position: focusedCardIndex,
              },
            });
            await loadCardsForColumns();
          } catch (e) {
            error = `Failed to paste card: ${e}`;
          }
        }
        break;

      case "scoreUp":
        if (card) {
          try {
            await invoke("update_card_score", { id: card.id, delta: 1 });
            await loadCardsForColumns();
          } catch (e) {
            error = `Failed to update score: ${e}`;
          }
        }
        break;

      case "scoreDown":
        if (card) {
          try {
            await invoke("update_card_score", { id: card.id, delta: -1 });
            await loadCardsForColumns();
          } catch (e) {
            error = `Failed to update score: ${e}`;
          }
        }
        break;

      case "jumpToColumn":
        if (param !== undefined) {
          const targetIndex = parseInt(param, 10);
          if (targetIndex >= 0 && targetIndex < columns.length && targetIndex !== focusedColumnIndex) {
            saveCurrentCardIndex();
            focusedColumnIndex = targetIndex;
            restoreCardIndex();
            const newCards = cardsByColumn[columns[focusedColumnIndex].id] ?? [];
            if (newCards.length === 0) {
              focusMode = "column";
            }
            scrollToFocusedColumn();
          }
        }
        break;

      case "undo":
        await undoLastDelete();
        break;
    }
  }

  // ============================================
  // Helper functions
  // ============================================

  async function reloadColumns() {
    if (!currentDeck) return;
    try {
      columns = await invoke<Column[]>("get_columns_by_deck", { deckId: currentDeck.id });
      await loadCardsForColumns();
    } catch (e) {
      error = `Failed to reload columns: ${e}`;
    }
  }

  async function createColumnAtPosition(position: number) {
    if (!currentDeck) return;
    try {
      const col = await invoke<Column>("create_column", {
        params: { deck_id: currentDeck.id, position },
      });
      await reloadColumns();
      focusedColumnIndex = columns.findIndex((c) => c.id === col.id);
      if (focusedColumnIndex === -1) focusedColumnIndex = 0;
      scrollToFocusedColumn();
    } catch (e) {
      error = `Failed to create column: ${e}`;
    }
  }

  async function createCardAtPosition(columnId: string, position: number) {
    try {
      const card = await invoke<Card>("create_card", {
        params: { column_id: columnId, content: "", position },
      });
      await loadCardsForColumns();
      const cards = cardsByColumn[columnId] ?? [];
      focusedCardIndex = cards.findIndex((c) => c.id === card.id);
      if (focusedCardIndex === -1) focusedCardIndex = 0;
      startEdit(card.id);
    } catch (e) {
      error = `Failed to create card: ${e}`;
    }
  }

  async function undoLastDelete() {
    const item = deletedStack.pop();
    if (!item) return;

    try {
      if (item.type === "card") {
        await invoke("restore_card", { id: item.id });
      } else {
        await invoke("restore_column", { id: item.id });
      }
      await reloadColumns();
    } catch (e) {
      // Restore failed, put item back on stack
      deletedStack.push(item);
      error = `Failed to undo: ${e}`;
    }
  }

  function scrollToFocusedColumn() {
    deckComponent?.scrollToColumn(focusedColumnIndex);
  }

  function saveCurrentCardIndex() {
    const column = columns[focusedColumnIndex];
    if (column) {
      lastFocusedCardByColumn[column.id] = focusedCardIndex;
    }
  }

  function restoreCardIndex() {
    const column = columns[focusedColumnIndex];
    if (!column) return;

    const cards = cardsByColumn[column.id] ?? [];
    const savedIndex = lastFocusedCardByColumn[column.id];

    if (savedIndex !== undefined && savedIndex < cards.length) {
      focusedCardIndex = savedIndex;
    } else {
      focusedCardIndex = Math.max(0, cards.length - 1);
    }
  }

  function handleFocusColumn(columnIndex: number) {
    if (focusedColumnIndex !== columnIndex) {
      saveCurrentCardIndex();
    }
    focusedColumnIndex = columnIndex;
    focusMode = "column";
  }

  function handleFocusCard(columnIndex: number, cardIndex: number) {
    if (focusedColumnIndex !== columnIndex) {
      saveCurrentCardIndex();
    }
    focusedColumnIndex = columnIndex;
    focusedCardIndex = cardIndex;
    focusMode = "card";
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
    <DeckComponent
      bind:this={deckComponent}
      {columns}
      {cardsByColumn}
      {focusedColumnIndex}
      focusedCardIndex={focusMode === "card" ? focusedCardIndex : -1}
      {editingCardId}
      onAddCard={createCard}
      onSaveCard={saveCard}
      onCancelEdit={cancelEdit}
      onStartEdit={startEdit}
      onExitEdit={exitEdit}
      onFocusColumn={handleFocusColumn}
      onFocusCard={handleFocusCard}
    />
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
