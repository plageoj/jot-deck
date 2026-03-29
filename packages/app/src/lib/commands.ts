export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: string;
}

export const COMMANDS: Command[] = [
  { id: "new-deck", label: "New Deck", action: "newDeck" },
  { id: "switch-column", label: "Switch Column", shortcut: "g n", action: "showColumnPalette" },
  { id: "new-column", label: "New Column", shortcut: "c", action: "newColumn" },
  { id: "delete-column", label: "Delete Column", shortcut: "d d", action: "deleteColumn" },
  { id: "shortcuts", label: "Keyboard Shortcuts", shortcut: "?", action: "showShortcuts" },
];

export function filterCommands(query: string): Command[] {
  const lower = query.trim().toLowerCase();
  if (!lower) return COMMANDS;
  return COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(lower));
}
