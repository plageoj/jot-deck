export interface Command {
  id: string;
  label: string;
  /**
   * Shown when the action has no keybinding (a fixed key handled outside the
   * keybinding registry). Bound actions show their effective key instead.
   */
  fixedShortcut?: string;
  action: string;
}

export const COMMANDS: Command[] = [
  { id: "switch-deck", label: "Switch Deck", action: "showDeckPalette" },
  { id: "new-deck", label: "New Deck", action: "newDeck" },
  { id: "restore-onboarding", label: "Restore Getting Started Deck", action: "restoreOnboarding" },
  { id: "rename-deck", label: "Rename Deck", action: "renameDeck" },
  { id: "delete-deck", label: "Delete Deck", action: "deleteDeck" },
  { id: "reload-deck", label: "Reload Deck", action: "reloadDeck" },
  { id: "switch-column", label: "Switch Column", action: "showColumnPalette" },
  { id: "new-column", label: "New Column", action: "createColumn" },
  { id: "rename-column", label: "Rename Column", action: "renameColumn" },
  { id: "delete-column", label: "Delete Column", action: "deleteColumn" },
  { id: "filter-tag", label: "Filter by Tag", action: "openTagFilter" },
  { id: "clear-filter", label: "Clear Tag Filter", action: "clearTagFilter" },
  { id: "trash", label: "Trash", action: "showTrashPalette" },
  { id: "settings", label: "Settings", action: "showSettings" },
  { id: "keybindings", label: "Customize Keybindings", action: "showKeybindings" },
  { id: "shortcuts", label: "Keyboard Shortcuts", fixedShortcut: "?", action: "showShortcuts" },
  { id: "check-updates", label: "Check for Updates", action: "checkForUpdates" },
  { id: "about", label: "About Jot Deck", action: "showAbout" },
];

export function filterCommands(query: string): Command[] {
  const lower = query.trim().toLowerCase();
  if (!lower) return COMMANDS;
  return COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(lower));
}
