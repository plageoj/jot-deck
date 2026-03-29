<script lang="ts">
  import { COMMANDS } from "$lib/commands";
  import PaletteDialog, { type PaletteItem } from "./PaletteDialog.svelte";

  interface Props {
    onExecute: (action: string) => void;
    onClose: () => void;
  }

  let { onExecute, onClose }: Props = $props();

  const items: PaletteItem[] = COMMANDS.map((cmd) => ({
    id: cmd.id,
    label: cmd.label,
    shortcut: cmd.shortcut,
  }));

  const actionById = new Map(COMMANDS.map((cmd) => [cmd.id, cmd.action]));

  function handleSelect(item: PaletteItem) {
    const action = actionById.get(item.id);
    if (action) onExecute(action);
  }
</script>

<PaletteDialog
  {items}
  placeholder="Type a command..."
  emptyMessage="No matching commands"
  onSelect={handleSelect}
  {onClose}
/>
