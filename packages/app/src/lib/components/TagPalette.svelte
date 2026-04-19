<script lang="ts">
  import type { Tag } from "$lib/types";
  import PaletteDialog, { type PaletteItem } from "./PaletteDialog.svelte";

  interface Props {
    tags: Tag[];
    activeTag?: string | null;
    onSelect: (tagName: string) => void;
    onClose: () => void;
  }

  let { tags, activeTag = null, onSelect, onClose }: Props = $props();

  let items = $derived<PaletteItem[]>(
    tags.map((tag) => ({
      id: tag.id,
      label: `#${tag.name}`,
      current: tag.name === activeTag,
    })),
  );

  function handleSelect(item: PaletteItem) {
    const tag = tags.find((t) => t.id === item.id);
    if (tag) onSelect(tag.name);
  }
</script>

<PaletteDialog
  {items}
  placeholder="Filter by tag..."
  emptyMessage="No tags in this deck"
  onSelect={handleSelect}
  {onClose}
/>
