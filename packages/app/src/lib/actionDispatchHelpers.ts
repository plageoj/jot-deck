import type { DeckData } from "./deckData.svelte";
import type { FocusManager } from "./focusManager.svelte";

/**
 * Handles actions that are independent of the current column/card focus mode.
 * Mode-specific board actions remain in ActionDispatcher.
 */
export function executeGlobalAction(
  action: string,
  data: DeckData,
  focus: FocusManager,
): boolean | Promise<boolean> {
  switch (action) {
    case "showCommandPalette":
      focus.openPalette("command");
      return true;
    case "showDeckPalette":
      focus.openPalette("deck");
      return true;
    case "showColumnPalette":
      focus.openPalette("column");
      return true;
    case "openTagFilter":
      focus.openPalette("tag");
      return true;
    case "showTrashPalette":
      focus.openPalette("trash");
      return true;
    case "showSettings":
      focus.showSettings = true;
      return true;
    case "showKeybindings":
      focus.showKeybindings = true;
      return true;
    case "showAbout":
      focus.showAbout = true;
      return true;
    case "showReporters":
      focus.showReporters = true;
      return true;
    case "clearTagFilter":
      data.clearTagFilter();
      return true;
    case "undo":
      return data.history.undo().then(
        () => true,
        (error) => {
          data.error = `Failed to undo: ${error}`;
          return true;
        },
      );
    case "redo":
      return data.history.redo().then(
        () => true,
        (error) => {
          data.error = `Failed to redo: ${error}`;
          return true;
        },
      );
    default:
      return false;
  }
}
