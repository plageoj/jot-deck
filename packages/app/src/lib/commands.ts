export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: string;
}

export const COMMANDS: Command[] = [
  { id: "switch-deck", label: "Switch Deck", shortcut: "Ctrl+P", action: "switchDeck" },
  { id: "new-deck", label: "New Deck", action: "newDeck" },
  { id: "rename-deck", label: "Rename Deck", action: "renameDeck" },
  { id: "delete-deck", label: "Delete Deck", action: "deleteDeck" },
  { id: "switch-column", label: "Switch Column", shortcut: "g n", action: "showColumnPalette" },
  { id: "new-column", label: "New Column", shortcut: "c", action: "newColumn" },
  { id: "delete-column", label: "Delete Column", shortcut: "d d", action: "deleteColumn" },
  { id: "filter-tag", label: "Filter by Tag", shortcut: "/", action: "openTagFilter" },
  { id: "clear-filter", label: "Clear Tag Filter", action: "clearTagFilter" },
  { id: "shortcuts", label: "Keyboard Shortcuts", shortcut: "?", action: "showShortcuts" },
];

export function filterCommands(query: string): Command[] {
  const lower = query.trim().toLowerCase();
  if (!lower) return COMMANDS;
  return COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(lower));
}
