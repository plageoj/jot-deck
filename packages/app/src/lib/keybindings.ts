export type FocusMode = "column" | "card" | "edit" | "command";

export interface KeyBinding {
  sequence: string;
  action: string;
  modes: FocusMode[];
  description: string;
}

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Column focus - Navigation
  { sequence: "h", action: "moveLeft", modes: ["column"], description: "Move to left column" },
  { sequence: "ArrowLeft", action: "moveLeft", modes: ["column"], description: "Move to left column" },
  { sequence: "l", action: "moveRight", modes: ["column"], description: "Move to right column" },
  { sequence: "ArrowRight", action: "moveRight", modes: ["column"], description: "Move to right column" },
  { sequence: "j", action: "enterCardFocusFirst", modes: ["column"], description: "Focus first card" },
  { sequence: "ArrowDown", action: "enterCardFocusFirst", modes: ["column"], description: "Focus first card" },
  { sequence: "k", action: "enterCardFocusLast", modes: ["column"], description: "Focus last card" },
  { sequence: "ArrowUp", action: "enterCardFocusLast", modes: ["column"], description: "Focus last card" },
  { sequence: "Enter", action: "enterCardFocusFirst", modes: ["column"], description: "Focus first card" },

  // Column focus - Operations
  { sequence: "H", action: "reorderColumnLeft", modes: ["column"], description: "Move column left" },
  { sequence: "Shift+ArrowLeft", action: "reorderColumnLeft", modes: ["column"], description: "Move column left" },
  { sequence: "L", action: "reorderColumnRight", modes: ["column"], description: "Move column right" },
  { sequence: "Shift+ArrowRight", action: "reorderColumnRight", modes: ["column"], description: "Move column right" },
  { sequence: "o", action: "createCard", modes: ["column"], description: "New card" },
  { sequence: "n", action: "createCard", modes: ["column"], description: "New card" },
  { sequence: "c", action: "createColumn", modes: ["column"], description: "New column" },
  { sequence: "N", action: "createColumn", modes: ["column", "card"], description: "New column" },
  { sequence: "dd", action: "deleteColumn", modes: ["column"], description: "Delete column" },
  { sequence: "Delete", action: "deleteColumn", modes: ["column"], description: "Delete column" },

  // Card focus - Navigation
  { sequence: "j", action: "moveDown", modes: ["card"], description: "Move down" },
  { sequence: "ArrowDown", action: "moveDown", modes: ["card"], description: "Move down" },
  { sequence: "k", action: "moveUp", modes: ["card"], description: "Move up" },
  { sequence: "ArrowUp", action: "moveUp", modes: ["card"], description: "Move up" },
  { sequence: "h", action: "moveLeft", modes: ["card"], description: "Move to left column" },
  { sequence: "ArrowLeft", action: "moveLeft", modes: ["card"], description: "Move to left column" },
  { sequence: "l", action: "moveRight", modes: ["card"], description: "Move to right column" },
  { sequence: "ArrowRight", action: "moveRight", modes: ["card"], description: "Move to right column" },
  { sequence: "gg", action: "goFirst", modes: ["card"], description: "Go to first" },
  { sequence: "Ctrl+ArrowUp", action: "goFirst", modes: ["card"], description: "Go to first" },
  { sequence: "G", action: "goLast", modes: ["card"], description: "Go to last" },
  { sequence: "Ctrl+ArrowDown", action: "goLast", modes: ["card"], description: "Go to last" },
  { sequence: "Ctrl+u", action: "scrollHalfPageUp", modes: ["card"], description: "Half page up" },
  { sequence: "PageUp", action: "scrollHalfPageUp", modes: ["card"], description: "Half page up" },
  { sequence: "Ctrl+d", action: "scrollHalfPageDown", modes: ["card"], description: "Half page down" },
  { sequence: "PageDown", action: "scrollHalfPageDown", modes: ["card"], description: "Half page down" },
  { sequence: "Escape", action: "exitToColumn", modes: ["card"], description: "Back to column focus" },

  // Card focus - Move card
  { sequence: "H", action: "moveCardLeft", modes: ["card"], description: "Move card to left column" },
  { sequence: "Shift+ArrowLeft", action: "moveCardLeft", modes: ["card"], description: "Move card to left column" },
  { sequence: "L", action: "moveCardRight", modes: ["card"], description: "Move card to right column" },
  { sequence: "Shift+ArrowRight", action: "moveCardRight", modes: ["card"], description: "Move card to right column" },
  { sequence: "J", action: "reorderCardDown", modes: ["card"], description: "Move card down" },
  { sequence: "Shift+ArrowDown", action: "reorderCardDown", modes: ["card"], description: "Move card down" },
  { sequence: "K", action: "reorderCardUp", modes: ["card"], description: "Move card up" },
  { sequence: "Shift+ArrowUp", action: "reorderCardUp", modes: ["card"], description: "Move card up" },

  // Card focus - Edit
  { sequence: "i", action: "startEdit", modes: ["card"], description: "Edit card" },
  { sequence: "a", action: "startEdit", modes: ["card"], description: "Edit card" },
  { sequence: "Enter", action: "startEdit", modes: ["card"], description: "Edit card" },

  // Card focus - Create
  { sequence: "o", action: "createCardBelow", modes: ["card"], description: "New card below" },
  { sequence: "n", action: "createCardBelow", modes: ["card"], description: "New card below" },
  { sequence: "O", action: "createCardAbove", modes: ["card"], description: "New card above" },

  // Card focus - Delete/Copy/Paste
  { sequence: "dd", action: "deleteCard", modes: ["card"], description: "Delete card" },
  { sequence: "Delete", action: "deleteCard", modes: ["card"], description: "Delete card" },
  { sequence: "yy", action: "copyCard", modes: ["card"], description: "Copy card" },
  { sequence: "p", action: "pasteBelow", modes: ["card"], description: "Paste below" },
  { sequence: "P", action: "pasteAbove", modes: ["card"], description: "Paste above" },

  // Card focus - Score
  { sequence: "f", action: "scoreUp", modes: ["card"], description: "Score +1" },
  { sequence: "+", action: "scoreUp", modes: ["card"], description: "Score +1" },
  { sequence: "=", action: "scoreUp", modes: ["card"], description: "Score +1" },
  { sequence: "F", action: "scoreDown", modes: ["card"], description: "Score -1" },
  { sequence: "-", action: "scoreDown", modes: ["card"], description: "Score -1" },

  // Common - Jump to column (g prefix)
  { sequence: "g1", action: "jumpToColumn:0", modes: ["column", "card"], description: "Jump to column 1" },
  { sequence: "g2", action: "jumpToColumn:1", modes: ["column", "card"], description: "Jump to column 2" },
  { sequence: "g3", action: "jumpToColumn:2", modes: ["column", "card"], description: "Jump to column 3" },
  { sequence: "g4", action: "jumpToColumn:3", modes: ["column", "card"], description: "Jump to column 4" },
  { sequence: "g5", action: "jumpToColumn:4", modes: ["column", "card"], description: "Jump to column 5" },
  { sequence: "g6", action: "jumpToColumn:5", modes: ["column", "card"], description: "Jump to column 6" },
  { sequence: "g7", action: "jumpToColumn:6", modes: ["column", "card"], description: "Jump to column 7" },
  { sequence: "g8", action: "jumpToColumn:7", modes: ["column", "card"], description: "Jump to column 8" },
  { sequence: "g9", action: "jumpToColumn:8", modes: ["column", "card"], description: "Jump to column 9" },

  // Common - Column palette
  { sequence: "gn", action: "showColumnPalette", modes: ["column", "card"], description: "Switch column" },
  { sequence: "gc", action: "showColumnPalette", modes: ["column", "card"], description: "Switch column" },
  { sequence: "Ctrl+t", action: "showColumnPalette", modes: ["column", "card"], description: "Switch column" },

  // Common - Tag filter
  { sequence: "/", action: "openTagFilter", modes: ["column", "card"], description: "Filter by tag" },

  // Common - Undo
  { sequence: "u", action: "undo", modes: ["column", "card"], description: "Undo" },

  // Common - Palettes (handled by ActionDispatcher.handleKeydown directly; listed for cheatsheet)
  { sequence: "Ctrl+p", action: "showDeckPalette", modes: ["column", "card"], description: "Switch deck" },
  { sequence: "Ctrl+Shift+p", action: "showCommandPalette", modes: ["column", "card"], description: "Command palette" },
  { sequence: "F1", action: "showCommandPalette", modes: ["column", "card"], description: "Command palette" },
];

/**
 * Find the action for a given key sequence and focus mode
 */
export function findAction(sequence: string, mode: FocusMode): string | null {
  const binding = DEFAULT_KEYBINDINGS.find(
    (b) => b.sequence === sequence && b.modes.includes(mode)
  );
  return binding?.action ?? null;
}

/**
 * Check if the given sequence is a valid prefix for any keybinding
 */
export function isValidPrefix(sequence: string, mode: FocusMode): boolean {
  return DEFAULT_KEYBINDINGS.some(
    (b) =>
      b.sequence.startsWith(sequence) &&
      b.sequence !== sequence &&
      b.modes.includes(mode)
  );
}

/**
 * Get all keybindings for display (cheatsheet)
 */
export function getKeybindingsForMode(mode: FocusMode): KeyBinding[] {
  return DEFAULT_KEYBINDINGS.filter((b) => b.modes.includes(mode));
}
