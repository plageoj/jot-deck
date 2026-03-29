export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: string;
}

export const COMMANDS: Command[] = [
  { id: "switch-deck", label: "Switch Deck", shortcut: "g h", action: "switchDeck" },
  { id: "new-deck", label: "New Deck", action: "newDeck" },
  { id: "new-column", label: "New Column", shortcut: "c", action: "newColumn" },
  { id: "delete-column", label: "Delete Column", shortcut: "d d", action: "deleteColumn" },
  { id: "trash", label: "Trash", shortcut: "g t", action: "showTrash" },
  { id: "settings", label: "Settings", action: "openSettings" },
  { id: "toggle-theme", label: "Toggle Theme", action: "toggleTheme" },
  { id: "shortcuts", label: "Keyboard Shortcuts", shortcut: "?", action: "showShortcuts" },
  { id: "ai-draft", label: "AI Draft", action: "aiDraft" },
];

export function filterCommands(query: string): Command[] {
  if (!query.trim()) return COMMANDS;
  const lower = query.toLowerCase();
  return COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(lower));
}
