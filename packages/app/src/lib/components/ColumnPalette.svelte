<script lang="ts">
  import type { Column } from "$lib/types";
  import PaletteDialog, { type PaletteItem } from "./PaletteDialog.svelte";

  interface Props {
    columns: Column[];
    focusedColumnIndex: number;
    onSelect: (columnIndex: number) => void;
    onClose: () => void;
  }

  let { columns, focusedColumnIndex, onSelect, onClose }: Props = $props();

  let items = $derived<PaletteItem[]>(
    columns.map((col, i) => ({
      id: col.id,
      label: col.name,
      shortcut: i < 9 ? `g ${i + 1}` : undefined,
      current: i === focusedColumnIndex,
    })),
  );

  function handleSelect(item: PaletteItem) {
    const index = columns.findIndex((col) => col.id === item.id);
    if (index !== -1) onSelect(index);
  }
</script>

<PaletteDialog
  {items}
  placeholder="Switch to column..."
  emptyMessage="No matching columns"
  onSelect={handleSelect}
  {onClose}
/>
