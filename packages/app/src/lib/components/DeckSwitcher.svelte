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
      <span class="current-name">{currentDeck.name}</span>
      <div class="current-stats">
        {columnCount}
        {columnCount === 1 ? "column" : "columns"},
        {cardCount}
        {cardCount === 1 ? "card" : "cards"}
      </div>
    </div>
  {/if}
{/snippet}

<style>
  .current-section {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--bg-tertiary);
  }

  .current-name {
    display: block;
    font-size: 1rem;
    font-weight: 600;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .current-stats {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
