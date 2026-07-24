<script lang="ts">
  import type { Deck } from "$lib/types";
  import PaletteDialog, { type PaletteItem } from "./PaletteDialog.svelte";

  interface Props {
    currentDeck: Deck | null;
    decks: Deck[];
    columnCount: number;
    cardCount: number;
    onSelect: (deck: Deck) => void;
    onNew: () => void;
    onRename: (deck: Deck) => void;
    onDelete: (deck: Deck) => void;
    /** Build a paste-ready mcpServers config snippet; null when unavailable
     * (e.g. browser backend). */
    getMcpConfig?: (deck: Deck) => Promise<string | null>;
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
    getMcpConfig,
    onClose,
  }: Props = $props();

  let idCopied = $state(false);
  let configCopied = $state(false);
  let idResetTimer: ReturnType<typeof setTimeout> | undefined;
  let configResetTimer: ReturnType<typeof setTimeout> | undefined;

  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard unavailable (e.g. permissions); report failure.
      return false;
    }
  }

  /** Copy the deck's ULID for pasting into JOT_DECK_DECK_ID
   * (docs/008-mcp-server.md §4.5). */
  async function copyDeckId() {
    if (!currentDeck) return;
    if (await writeClipboard(currentDeck.id)) {
      idCopied = true;
      clearTimeout(idResetTimer);
      idResetTimer = setTimeout(() => (idCopied = false), 1500);
    }
  }

  /** Copy a full, paste-ready mcpServers config snippet (bridge path + deck id).
   * The desktop app fills in the bundled bridge path; the DB path is derived by
   * the bridge itself (docs/008-mcp-server.md §4.6). Falls back to copying just
   * the deck id when the full snippet is unavailable (browser backend). */
  async function copyConfig() {
    if (!currentDeck) return;
    const snippet = getMcpConfig ? await getMcpConfig(currentDeck) : null;
    const ok = await writeClipboard(snippet ?? currentDeck.id);
    if (ok) {
      configCopied = true;
      clearTimeout(configResetTimer);
      configResetTimer = setTimeout(() => (configCopied = false), 1500);
    }
  }

  type DeckAction =
    | { kind: "select"; deck: Deck }
    | { kind: "rename"; deck: Deck }
    | { kind: "delete"; deck: Deck }
    | { kind: "new" };

  type DeckPaletteItem = PaletteItem & { action: DeckAction };

  let items = $derived.by<DeckPaletteItem[]>(() => {
    const list: DeckPaletteItem[] = decks
      .filter((d) => d.id !== currentDeck?.id)
      .map((deck) => ({
        id: deck.id,
        label: deck.name,
        section: "Other decks",
        action: { kind: "select", deck },
      }));

    if (currentDeck) {
      list.push({
        id: "__rename",
        label: "Rename deck",
        section: "Actions",
        icon: "rename",
        action: { kind: "rename", deck: currentDeck },
      });
      if (decks.length > 1) {
        list.push({
          id: "__delete",
          label: "Delete deck",
          section: "Actions",
          danger: true,
          icon: "delete",
          action: { kind: "delete", deck: currentDeck },
        });
      }
    }

    list.push({
      id: "__new",
      label: "New deck",
      section: "Actions",
      icon: "new",
      action: { kind: "new" },
    });

    return list;
  });

  function handleSelect(item: DeckPaletteItem) {
    const action = item.action;
    switch (action.kind) {
      case "select":
        onSelect(action.deck);
        break;
      case "rename":
        onRename(action.deck);
        break;
      case "delete":
        onDelete(action.deck);
        break;
      case "new":
        onNew();
        break;
    }
  }
</script>

<PaletteDialog
  {items}
  placeholder="Switch to deck..."
  emptyMessage="No matching decks"
  onSelect={handleSelect}
  {onClose}
  {header}
/>

{#snippet header()}
  {#if currentDeck}
    <div class="current-section">
      <div class="current-header">
        <span class="current-name">{currentDeck.name}</span>
        <button
          class="icon-btn"
          title={configCopied ? "Copied!" : "Copy MCP server config"}
          aria-label="Copy MCP server config"
          onclick={copyConfig}
        >
          {#if configCopied}
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
              <path d="M20 6 9 17l-5-5" />
            </svg>
          {:else}
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
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          {/if}
        </button>
      </div>
      <div class="current-stats">
        {columnCount}
        {columnCount === 1 ? "column" : "columns"},
        {cardCount}
        {cardCount === 1 ? "card" : "cards"}
      </div>
      <button
        type="button"
        class="deck-id-row"
        title="Copy MCP deck id"
        onclick={copyDeckId}
      >
        <span class="deck-id-label">MCP id</span>
        <code class="deck-id-value">{currentDeck.id}</code>
        <span class="deck-id-hint">{idCopied ? "Copied!" : "Copy"}</span>
      </button>
    </div>
  {/if}
{/snippet}

<style>
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
    display: block;
    font-size: 1rem;
    font-weight: 600;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
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
    flex-shrink: 0;
    transition:
      color 0.15s ease,
      background-color 0.15s ease;
  }

  .icon-btn:hover {
    color: var(--text);
    background-color: var(--bg-tertiary);
  }

  .current-stats {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .deck-id-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--bg-tertiary);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    transition:
      background-color 0.1s ease,
      color 0.1s ease;
  }

  .deck-id-row:hover {
    background-color: var(--bg-tertiary);
    color: var(--text);
  }

  .deck-id-label {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .deck-id-value {
    font-family: var(--font-mono, monospace);
    font-size: 0.6875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .deck-id-hint {
    font-size: 0.625rem;
    flex-shrink: 0;
  }
</style>
