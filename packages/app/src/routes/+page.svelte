<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import {
    AboutDialog,
    Deck as DeckComponent,
    ColumnPalette,
    CommandPalette,
    ConfirmDialog,
    DeckSwitcher,
    KeybindingCheatsheet,
    KeybindingsDialog,
    RenameDialog,
    ReportersDialog,
    SettingsDialog,
    TagFilterBar,
    TagPalette,
    TrashPalette,
    UpdateBanner,
  } from "$lib/components";
  import { DeckData } from "$lib/deckData.svelte";
  import { FocusManager } from "$lib/focusManager.svelte";
  import { ActionDispatcher } from "$lib/actionDispatcher.svelte";
  import {
    applySettingsToDocument,
    settingsStore,
  } from "$lib/settings.svelte";
  import { updaterStore } from "$lib/updater.svelte";
  import type { Column, Deck, TrashItem } from "$lib/types";
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

  // Persist & restore focus state per deck. Switching the deck reassigns
  // FocusManager's persistence target (saving prior state, then loading the
  // new deck's saved state). Clamping to actual column/card counts waits for
  // `loadedDeckId` so it runs against the freshly loaded column list.
  let restoredForDeckId = $state<string | null>(null);
  $effect(() => {
    const deckId = data.currentDeck?.id ?? null;
    focus.setCurrentDeck(deckId);
    restoredForDeckId = null;
  });

  $effect(() => {
    const loaded = data.loadedDeckId;
    if (
      !FocusManager.shouldClampForLoadedDeck({
        loaded,
        restoredForDeckId,
        currentDeckId: data.currentDeck?.id ?? null,
      })
    ) {
      return;
    }
    focus.clampToLoadedDeck();
    restoredForDeckId = loaded;
    tick().then(() => {
      if (data.loadedDeckId === loaded) focus.scrollToFocusedColumn();
    });
  });

  // Save state on focus changes once the active deck has been restored.
  $effect(() => {
    void focus.focusedColumnIndex;
    void focus.focusedCardIndex;
    void focus.lastFocusedCardByColumn;
    if (restoredForDeckId) focus.persistCurrent();
  });

  let deckComponent = $state<DeckComponent | null>(null);

  // Settings: hydrate from SQLite, then apply reactively whenever the store
  // changes (theme attribute + font CSS variables on <html>). The first apply
  // runs against defaults; the second runs once the DB load resolves.
  $effect(() => {
    applySettingsToDocument(settingsStore.state);
  });

  onMount(async () => {
    focus.onScrollToColumn = (index) => deckComponent?.scrollToColumn(index);
    actions.onRenameDeck = () => {
      if (data.currentDeck) handleRenameDeck(data.currentDeck);
    };
    actions.onDeleteDeck = () => {
      if (data.currentDeck) handleDeleteDeck(data.currentDeck);
    };
    actions.onRenameColumn = () => {
      const col = data.columns[focus.focusedColumnIndex];
      if (col) handleRenameColumn(col);
    };
    actions.onDeleteColumn = () => {
      const col = data.columns[focus.focusedColumnIndex];
      if (col) handleDeleteColumn(col);
    };
    window.addEventListener("keydown", actions.handleKeydown);
    await Promise.all([data.init(), settingsStore.load()]);
    // React to writes from other processes (CLI / MCP bridge) on the shared DB.
    void data.watchExternalChanges();
    // Non-blocking — failures surface in the banner, never throw out of mount.
    void updaterStore.check();
  });

  // Apply external-change reloads when a new tick arrives and the user isn't
  // mid-edit. The effect also reads focusMode, so a change observed while editing
  // is applied as soon as edit focus ends — no separate flush path. Recording the
  // consumed tick keeps an unrelated focusMode change from re-triggering a reload.
  let appliedExternalTick = 0;
  $effect(() => {
    const tick = data.externalChangeTick;
    if (focus.focusMode === "edit") return; // defer; re-runs when focusMode changes
    if (tick === appliedExternalTick) return;
    appliedExternalTick = tick;
    // Clamp focus after the reload: an external deletion can leave the focused
    // column/card index out of range, and the loadedDeckId-based clamp effect
    // doesn't run because the deck id is unchanged.
    void data.reloadFromExternalChange().then(() => focus.clampToLoadedDeck());
  });

  onDestroy(() => {
    window.removeEventListener("keydown", actions.handleKeydown);
    actions.destroy();
    data.stopWatchingExternalChanges();
  });

  let renamingDeck = $state<Deck | null>(null);
  let deletingDeck = $state<Deck | null>(null);
  let renamingColumn = $state<Column | null>(null);
  let deletingColumn = $state<Column | null>(null);
  let trashItems = $state<TrashItem[]>([]);
  let trashRequestId = 0;

  $effect(() => {
    if (focus.activePalette === "trash") {
      const requestId = ++trashRequestId;
      data.getTrashItems().then((items) => {
        // Drop late results if the palette has since closed or refetched.
        if (requestId === trashRequestId) {
          trashItems = items;
        }
      });
    } else {
      trashRequestId++;
      trashItems = [];
    }
  });

  function handleRenameDeck(deck: Deck) {
    renamingDeck = deck;
  }

  function handleDeleteDeck(deck: Deck) {
    deletingDeck = deck;
  }

  function handleRenameColumn(column: Column) {
    renamingColumn = column;
  }

  function handleDeleteColumn(column: Column) {
    deletingColumn = column;
  }

  let totalCardCount = $derived(
    Object.values(data.cardsByColumn).reduce((sum, cards) => sum + cards.length, 0),
  );
</script>

<main class="app">
  <UpdateBanner />
  <header class="header">
    <h1>{data.currentDeck?.name ?? "Jot Deck"}</h1>
    <button onclick={() => focus.openPalette("deck")} title="Manage Decks (Ctrl+P)"
      >Manage Decks</button
    >
    <button onclick={() => data.createColumn()} disabled={!data.currentDeck}
      >New Column</button
    >
    <button
      onclick={() => (focus.showReporters = true)}
      disabled={!data.currentDeck}
      title="Manage Reporters (g r)">Reporters</button
    >
    <button
      class="header-spacer"
      onclick={() => (focus.showSettings = true)}
      title="Settings (Ctrl+,)"
      aria-label="Open settings">Settings</button
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
      streamingText={data.streamingText}
      onAddCard={async (columnId) => {
        const card = await data.createCard(columnId);
        if (card) focus.editingCardId = card.id;
      }}
      onSaveCard={(cardId, content) => data.saveCard(cardId, content)}
      onCancelEdit={() => focus.cancelEdit()}
      onStartEdit={(cardId) => {
        // A card being streamed by a Reporter is read-only (007 §7).
        if (data.isStreaming(cardId)) return;
        focus.startEdit(cardId);
      }}
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

{#if focus.activePalette === "deck"}
  <DeckSwitcher
    currentDeck={data.currentDeck}
    decks={data.decks}
    columnCount={data.columns.length}
    cardCount={totalCardCount}
    onSelect={(deck) => actions.selectDeckFromPalette(deck.id)}
    onNew={() => {
      focus.closePalette();
      data.createDeck();
    }}
    onRename={(deck) => {
      focus.closePalette();
      handleRenameDeck(deck);
    }}
    onDelete={(deck) => {
      focus.closePalette();
      handleDeleteDeck(deck);
    }}
    getMcpConfig={(deck) => data.generateMcpConfig(deck.id)}
    onClose={() => focus.closePalette()}
  />
{:else if focus.activePalette === "tag"}
  <TagPalette
    tags={data.deckTags}
    activeTag={data.activeTagFilter}
    onSelect={(tagName) => {
      focus.closePalette();
      data.filterByTag(tagName);
    }}
    onClose={() => focus.closePalette()}
  />
{:else if focus.activePalette === "trash"}
  <TrashPalette
    items={trashItems}
    onRestore={async (item) => {
      focus.closePalette();
      await data.restoreTrashItem(item);
    }}
    onClose={() => focus.closePalette()}
  />
{:else if focus.activePalette === "column"}
  <ColumnPalette
    columns={data.columns}
    cardsByColumn={data.cardsByColumn}
    focusedColumnIndex={focus.focusedColumnIndex}
    onSelect={(i) => actions.selectColumnFromPalette(i)}
    onNew={() => {
      focus.closePalette();
      data.createColumn();
    }}
    onRename={(column) => {
      focus.closePalette();
      handleRenameColumn(column);
    }}
    onDelete={(column) => {
      focus.closePalette();
      handleDeleteColumn(column);
    }}
    onClose={() => focus.closePalette()}
  />
{:else if focus.focusMode === "command"}
  <CommandPalette
    onExecute={(action) => actions.executeCommand(action)}
    onClose={() => focus.closePalette()}
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

{#if renamingColumn}
  <RenameDialog
    title="Rename Column"
    value={renamingColumn.name}
    onConfirm={(newName) => {
      data.renameColumn(renamingColumn!.id, newName);
      renamingColumn = null;
    }}
    onClose={() => (renamingColumn = null)}
  />
{/if}

{#if deletingColumn}
  <ConfirmDialog
    title="Delete Column"
    message={`Delete "${deletingColumn.name}"? All cards in this column will be soft-deleted. You can undo with "u".`}
    confirmLabel="Delete"
    onConfirm={async () => {
      const col = deletingColumn!;
      deletingColumn = null;
      if (await data.deleteColumn(col.id)) {
        focus.focusedColumnIndex = Math.min(
          focus.focusedColumnIndex,
          Math.max(0, data.columns.length - 1),
        );
        focus.scrollToFocusedColumn();
      }
    }}
    onClose={() => (deletingColumn = null)}
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

{#if focus.showSettings}
  <SettingsDialog
    settings={settingsStore.state}
    onUpdate={(key, value) => settingsStore.update(key, value)}
    onReset={() => settingsStore.reset()}
    onOpenKeybindings={() => {
      focus.showSettings = false;
      focus.showKeybindings = true;
    }}
    onOpenAbout={() => {
      focus.showSettings = false;
      focus.showAbout = true;
    }}
    onClose={() => (focus.showSettings = false)}
  />
{/if}

{#if focus.showKeybindings}
  <KeybindingsDialog onClose={() => (focus.showKeybindings = false)} />
{/if}

{#if focus.showAbout}
  <AboutDialog onClose={() => (focus.showAbout = false)} />
{/if}

{#if focus.showReporters && data.currentDeck}
  <ReportersDialog
    deckId={data.currentDeck.id}
    listReporters={(deckId) => data.listReporters(deckId)}
    listRunning={() => data.listRunningReporters()}
    onAdd={(deckId, config) => data.addReporter(deckId, config)}
    onUpdate={(deckId, config) => data.updateReporter(deckId, config)}
    onRemove={(deckId, reporterId) => data.removeReporter(deckId, reporterId)}
    onStart={(deckId, reporterId) => data.startReporter(deckId, reporterId)}
    onStop={(reporterId) => data.stopReporter(reporterId)}
    onClose={() => (focus.showReporters = false)}
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

  .header .header-spacer {
    margin-left: auto;
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
