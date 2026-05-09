<script lang="ts">
  import type { TrashItem } from "$lib/types";
  import PaletteDialog, { type PaletteItem } from "./PaletteDialog.svelte";

  interface Props {
    items: TrashItem[];
    onRestore: (item: TrashItem) => void;
    onClose: () => void;
  }

  let { items, onRestore, onClose }: Props = $props();

  type TrashPaletteItem = PaletteItem & { trash: TrashItem };

  function previewLabel(item: TrashItem): string {
    if (item.type === "column") return item.column.name;
    const firstLine = item.card.content.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 0 ? firstLine : "(empty card)";
  }

  function relativeTime(iso: string): string {
    if (!iso) return "";
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return "";
    const sec = Math.round((Date.now() - then) / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
  }

  let paletteItems = $derived<TrashPaletteItem[]>(
    items.map((trash) => ({
      id: trash.id,
      label: previewLabel(trash),
      trash,
    })),
  );

  function handleSelect(item: TrashPaletteItem) {
    onRestore(item.trash);
  }
</script>

<PaletteDialog
  items={paletteItems}
  placeholder="Search trash..."
  emptyMessage={items.length === 0 ? "Trash is empty" : "No matching items"}
  onSelect={handleSelect}
  {onClose}
  renderItem={trashItem}
/>

{#snippet trashItem(item: TrashPaletteItem)}
  <span class="trash-type-badge" class:column={item.trash.type === "column"}>
    {item.trash.type === "column" ? "Col" : "Card"}
  </span>
  <span class="trash-label">{item.label}</span>
  <span class="trash-meta">
    {#if item.trash.type === "card" && item.trash.columnName}
      <span class="trash-column">{item.trash.columnName}</span>
    {/if}
    <span class="trash-time">{relativeTime(item.trash.deletedAt)}</span>
  </span>
{/snippet}

<style>
  .trash-type-badge {
    flex-shrink: 0;
    padding: 0.0625rem 0.375rem;
    border-radius: 3px;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-family: monospace;
    text-transform: uppercase;
  }

  .trash-type-badge.column {
    color: var(--accent);
    border-color: var(--accent);
  }

  .trash-label {
    flex: 1;
    color: var(--text);
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    margin: 0 0.5rem;
  }

  .trash-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .trash-column {
    padding: 0.0625rem 0.375rem;
    border-radius: 3px;
    background-color: var(--bg-primary);
    border: 1px solid var(--bg-tertiary);
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
