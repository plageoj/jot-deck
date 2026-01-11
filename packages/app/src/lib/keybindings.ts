export type FocusMode = "column" | "card" | "edit";

export interface KeyBinding {
  sequence: string;
  action: string;
  modes: FocusMode[];
  description: string;
}

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  // Column focus - Navigation
  { sequence: "h", action: "moveLeft", modes: ["column"], description: "左のカラムへ" },
  { sequence: "l", action: "moveRight", modes: ["column"], description: "右のカラムへ" },
  { sequence: "j", action: "enterCardFocusFirst", modes: ["column"], description: "Card フォーカスへ（最初）" },
  { sequence: "k", action: "enterCardFocusLast", modes: ["column"], description: "Card フォーカスへ（最後）" },
  { sequence: "Enter", action: "enterCardFocusFirst", modes: ["column"], description: "Card フォーカスへ" },

  // Column focus - Operations
  { sequence: "H", action: "reorderColumnLeft", modes: ["column"], description: "カラムを左へ移動" },
  { sequence: "L", action: "reorderColumnRight", modes: ["column"], description: "カラムを右へ移動" },
  { sequence: "o", action: "createCard", modes: ["column"], description: "新規カード作成" },
  { sequence: "n", action: "createCard", modes: ["column"], description: "新規カード作成" },
  { sequence: "c", action: "createColumn", modes: ["column"], description: "新規カラム作成" },
  { sequence: "N", action: "createColumn", modes: ["column", "card"], description: "新規カラム作成" },
  { sequence: "dd", action: "deleteColumn", modes: ["column"], description: "カラム削除" },
  { sequence: "Delete", action: "deleteColumn", modes: ["column"], description: "カラム削除" },
  { sequence: "r", action: "renameColumn", modes: ["column"], description: "カラム名編集" },

  // Card focus - Navigation
  { sequence: "j", action: "moveDown", modes: ["card"], description: "下のカードへ" },
  { sequence: "k", action: "moveUp", modes: ["card"], description: "上のカードへ" },
  { sequence: "h", action: "moveLeft", modes: ["card"], description: "左のカラムへ" },
  { sequence: "l", action: "moveRight", modes: ["card"], description: "右のカラムへ" },
  { sequence: "gg", action: "goFirst", modes: ["card"], description: "先頭へ" },
  { sequence: "G", action: "goLast", modes: ["card"], description: "末尾へ" },
  { sequence: "Escape", action: "exitToColumn", modes: ["card"], description: "Column フォーカスへ" },

  // Card focus - Move card
  { sequence: "H", action: "moveCardLeft", modes: ["card"], description: "カードを左カラムへ" },
  { sequence: "L", action: "moveCardRight", modes: ["card"], description: "カードを右カラムへ" },
  { sequence: "J", action: "reorderCardDown", modes: ["card"], description: "カードを下へ" },
  { sequence: "K", action: "reorderCardUp", modes: ["card"], description: "カードを上へ" },

  // Card focus - Edit
  { sequence: "i", action: "startEdit", modes: ["card"], description: "編集開始" },
  { sequence: "a", action: "startEdit", modes: ["card"], description: "編集開始" },
  { sequence: "Enter", action: "startEdit", modes: ["card"], description: "編集開始" },

  // Card focus - Create
  { sequence: "o", action: "createCardBelow", modes: ["card"], description: "下に新規カード" },
  { sequence: "n", action: "createCardBelow", modes: ["card"], description: "下に新規カード" },
  { sequence: "O", action: "createCardAbove", modes: ["card"], description: "上に新規カード" },

  // Card focus - Delete/Copy/Paste
  { sequence: "dd", action: "deleteCard", modes: ["card"], description: "カード削除" },
  { sequence: "Delete", action: "deleteCard", modes: ["card"], description: "カード削除" },
  { sequence: "yy", action: "copyCard", modes: ["card"], description: "コピー" },
  { sequence: "p", action: "pasteBelow", modes: ["card"], description: "下にペースト" },
  { sequence: "P", action: "pasteAbove", modes: ["card"], description: "上にペースト" },

  // Card focus - Score
  { sequence: "f", action: "scoreUp", modes: ["card"], description: "スコア +1" },
  { sequence: "+", action: "scoreUp", modes: ["card"], description: "スコア +1" },
  { sequence: "=", action: "scoreUp", modes: ["card"], description: "スコア +1" },
  { sequence: "F", action: "scoreDown", modes: ["card"], description: "スコア -1" },
  { sequence: "-", action: "scoreDown", modes: ["card"], description: "スコア -1" },

  // Common - Jump to column (g prefix)
  { sequence: "g1", action: "jumpToColumn:0", modes: ["column", "card"], description: "1番目のカラムへ" },
  { sequence: "g2", action: "jumpToColumn:1", modes: ["column", "card"], description: "2番目のカラムへ" },
  { sequence: "g3", action: "jumpToColumn:2", modes: ["column", "card"], description: "3番目のカラムへ" },
  { sequence: "g4", action: "jumpToColumn:3", modes: ["column", "card"], description: "4番目のカラムへ" },
  { sequence: "g5", action: "jumpToColumn:4", modes: ["column", "card"], description: "5番目のカラムへ" },
  { sequence: "g6", action: "jumpToColumn:5", modes: ["column", "card"], description: "6番目のカラムへ" },
  { sequence: "g7", action: "jumpToColumn:6", modes: ["column", "card"], description: "7番目のカラムへ" },
  { sequence: "g8", action: "jumpToColumn:7", modes: ["column", "card"], description: "8番目のカラムへ" },
  { sequence: "g9", action: "jumpToColumn:8", modes: ["column", "card"], description: "9番目のカラムへ" },

  // Common - Undo
  { sequence: "u", action: "undo", modes: ["column", "card"], description: "Undo" },
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
