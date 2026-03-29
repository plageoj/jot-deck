import { test, expect, Page } from "@playwright/test";

/**
 * Demo E2E Test for Jot Deck
 *
 * This test showcases the main features of Jot Deck and can be used
 * to record a demo video. Run with:
 *   pnpm test:e2e:demo
 *
 * The video will be saved to test-results/
 */

// Helper to type into CodeMirror Vim editor
// The editor starts in Vim normal mode, so we need to press 'i' to enter insert mode
async function typeInEditor(page: Page, text: string) {
  // Editor should be focused, press 'i' to enter insert mode
  await page.keyboard.press("i");
  await page.waitForTimeout(100);
  // Type the text
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(100);
}

// Helper to save and exit editor with Ctrl+Enter
async function saveAndExitEditor(page: Page) {
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(300);
}

// Helper to ensure a deck and column exist (idempotent setup)
async function ensureDeckAndColumn(page: Page) {
  const noDeckMessage = page.locator("text=No decks yet");
  if (await noDeckMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.click("text=Create Deck");
    await page.waitForTimeout(500);
  }
  const noColumnsMessage = page.locator("text=No columns in this deck");
  if (await noColumnsMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.click("text=Create Column");
    await page.waitForTimeout(500);
  }
}

test.describe("Jot Deck Demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for app to load
    await expect(page.locator("h1")).toContainText("Jot Deck");
    // Wait for WASM SQLite to initialize
    await page.waitForTimeout(1000);
  });

  test("full demo walkthrough", async ({ page }) => {
    // ========================================
    // Scene 1-2: Create deck and first column if needed
    // ========================================
    await ensureDeckAndColumn(page);

    // Ensure we're in column mode
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // ========================================
    // Scene 3: Create more columns with keyboard
    // ========================================
    // Press 'c' to create columns - wait for each to appear
    await page.keyboard.press("c");
    await expect(page.locator(".column")).toHaveCount(2, { timeout: 5000 });
    await page.waitForTimeout(300);

    await page.keyboard.press("c");
    await expect(page.locator(".column")).toHaveCount(3, { timeout: 5000 });
    await page.waitForTimeout(300);

    // ========================================
    // Scene 4: Navigate between columns
    // ========================================
    // Go to first column
    await page.keyboard.press("g");
    await page.keyboard.press("1");
    await page.waitForTimeout(300);

    // Navigate right
    await page.keyboard.press("l");
    await page.waitForTimeout(300);
    await page.keyboard.press("l");
    await page.waitForTimeout(300);

    // Navigate left
    await page.keyboard.press("h");
    await page.waitForTimeout(300);
    await page.keyboard.press("h");
    await page.waitForTimeout(300);

    // ========================================
    // Scene 5: Create cards in first column
    // ========================================
    // Press 'o' to create a new card (enters edit mode)
    await page.keyboard.press("o");
    await page.waitForTimeout(500);

    // Type content (editor is in Vim mode, starts in insert mode for new cards)
    await typeInEditor(page, "Welcome to Jot Deck! #demo");
    await saveAndExitEditor(page);

    // Create another card
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Keyboard-first design");
    await saveAndExitEditor(page);

    // Create one more
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Vim-style navigation");
    await saveAndExitEditor(page);

    // Verify cards exist
    await expect(page.locator("text=Welcome to Jot Deck!")).toBeVisible();
    await expect(page.locator("text=Keyboard-first design")).toBeVisible();
    await expect(page.locator("text=Vim-style navigation")).toBeVisible();

    // ========================================
    // Scene 6: Navigate between cards
    // ========================================
    // Move up with 'k'
    await page.keyboard.press("k");
    await page.waitForTimeout(300);
    await page.keyboard.press("k");
    await page.waitForTimeout(300);

    // Move down with 'j'
    await page.keyboard.press("j");
    await page.waitForTimeout(300);

    // Jump to first with 'gg'
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await page.waitForTimeout(300);

    // Jump to last with 'G'
    await page.keyboard.press("Shift+g");
    await page.waitForTimeout(300);

    // ========================================
    // Scene 7: Move to another column and add cards
    // ========================================
    await page.keyboard.press("l");
    await page.waitForTimeout(300);

    // Go to column mode (in case column is empty)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Create card in second column
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Ideas column #ideas");
    await saveAndExitEditor(page);

    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Add more features");
    await saveAndExitEditor(page);

    // ========================================
    // Scene 8: Copy and paste cards
    // ========================================
    // Go up to select a card
    await page.keyboard.press("k");
    await page.waitForTimeout(200);

    // Copy with 'yy'
    await page.keyboard.press("y");
    await page.keyboard.press("y");
    await page.waitForTimeout(300);

    // Paste below with 'p'
    await page.keyboard.press("p");
    await page.waitForTimeout(500);

    // ========================================
    // Scene 9: Delete and undo
    // ========================================
    // Delete with 'dd'
    await page.keyboard.press("d");
    await page.keyboard.press("d");
    await page.waitForTimeout(500);

    // Undo with 'u'
    await page.keyboard.press("u");
    await page.waitForTimeout(500);

    // ========================================
    // Scene 10: Reorder cards
    // ========================================
    // Move card up with 'K'
    await page.keyboard.press("Shift+k");
    await page.waitForTimeout(400);

    // Move card down with 'J'
    await page.keyboard.press("Shift+j");
    await page.waitForTimeout(400);

    // ========================================
    // Scene 11: Move cards between columns
    // ========================================
    // Move card left with 'H'
    await page.keyboard.press("Shift+h");
    await page.waitForTimeout(500);

    // Move card right with 'L'
    await page.keyboard.press("Shift+l");
    await page.waitForTimeout(500);

    // ========================================
    // Scene 12: Score/favorite cards
    // ========================================
    await page.keyboard.press("f");
    await page.waitForTimeout(300);
    await page.keyboard.press("f");
    await page.waitForTimeout(300);

    // ========================================
    // Scene 13: Jump to columns by number
    // ========================================
    await page.keyboard.press("g");
    await page.keyboard.press("1");
    await page.waitForTimeout(400);

    await page.keyboard.press("g");
    await page.keyboard.press("3");
    await page.waitForTimeout(400);

    // ========================================
    // Scene 14: Column reordering (in column mode)
    // ========================================
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Reorder with Shift+L and Shift+H
    await page.keyboard.press("Shift+l");
    await page.waitForTimeout(400);
    await page.keyboard.press("Shift+h");
    await page.waitForTimeout(400);

    // ========================================
    // Scene 15: Final overview
    // ========================================
    await page.keyboard.press("g");
    await page.keyboard.press("1");
    await page.waitForTimeout(500);

    // End with a pause
    await page.waitForTimeout(2000);
  });
});

test.describe("Command Palette & Keybinding Cheatsheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Jot Deck");
    await page.waitForTimeout(1000);

    await ensureDeckAndColumn(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  test("command palette opens with Ctrl+Shift+P and closes with Escape", async ({ page }) => {
    // Open command palette
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);

    // Verify palette is visible
    const overlay = page.locator(".palette-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator(".palette-input")).toBeFocused();

    // Verify commands are listed
    await expect(page.locator(".palette-item")).toHaveCount(9);

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(overlay).not.toBeVisible();
  });

  test("command palette opens with F1", async ({ page }) => {
    await page.keyboard.press("F1");
    await page.waitForTimeout(300);
    await expect(page.locator(".palette-overlay")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  test("command palette filters commands by text input", async ({ page }) => {
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);

    // Type to filter
    await page.keyboard.type("col", { delay: 50 });
    await page.waitForTimeout(200);

    // Only column-related commands should appear
    const items = page.locator(".palette-item");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(items.nth(i)).toContainText(/[Cc]olumn/);
    }

    // Clear and type something with no match
    await page.locator(".palette-input").fill("zzzzz");
    await page.waitForTimeout(200);
    await expect(page.locator(".palette-empty")).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("command palette navigates with arrow keys and executes with Enter", async ({ page }) => {
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);

    // Filter to "New Column"
    await page.keyboard.type("new col", { delay: 50 });
    await page.waitForTimeout(200);

    const columnCountBefore = await page.locator(".column").count();

    // Press Enter to execute
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // Palette should be closed and a new column should be created
    await expect(page.locator(".palette-overlay")).not.toBeVisible();
    await expect(page.locator(".column")).toHaveCount(columnCountBefore + 1);
  });

  test("command palette closes when clicking backdrop", async ({ page }) => {
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);
    await expect(page.locator(".palette-overlay")).toBeVisible();

    // Click the backdrop (outside the panel)
    await page.locator(".palette-overlay").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator(".palette-overlay")).not.toBeVisible();
  });

  test("keybinding cheatsheet opens with ? and closes with Escape", async ({ page }) => {
    // Press ? to open cheatsheet
    await page.keyboard.press("Shift+/");
    await page.waitForTimeout(300);

    // Verify cheatsheet is visible
    const overlay = page.locator(".cheatsheet-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator(".cheatsheet-header h2")).toContainText("Keyboard Shortcuts");

    // Verify keybindings are listed
    const rows = page.locator(".cheatsheet-item");
    expect(await rows.count()).toBeGreaterThan(0);

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(overlay).not.toBeVisible();
  });

  test("keybinding cheatsheet groups duplicate bindings", async ({ page }) => {
    // Press ? in column mode
    await page.keyboard.press("Shift+/");
    await page.waitForTimeout(300);

    // "h" and "ArrowLeft" should be grouped — look for a separator
    const separators = page.locator(".cheatsheet-list .separator");
    expect(await separators.count()).toBeGreaterThan(0);

    // Verify at least one row has multiple kbd elements (grouped keys)
    const firstGroupedRow = page.locator(".cheatsheet-item").filter({
      has: page.locator(".separator"),
    });
    expect(await firstGroupedRow.count()).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
  });

  test("keybinding cheatsheet shows mode-specific bindings", async ({ page }) => {
    // Open cheatsheet in column mode
    await page.keyboard.press("Shift+/");
    await page.waitForTimeout(300);
    await expect(page.locator(".cheatsheet-header h2")).toContainText("Column Mode");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Switch to card mode — need a card first
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "test card");
    await saveAndExitEditor(page);

    // Open cheatsheet in card mode
    await page.keyboard.press("Shift+/");
    await page.waitForTimeout(300);
    await expect(page.locator(".cheatsheet-header h2")).toContainText("Card Mode");
    await page.keyboard.press("Escape");
  });

  test("command palette 'Keyboard Shortcuts' command opens cheatsheet", async ({ page }) => {
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);

    // Filter to shortcuts command
    await page.keyboard.type("keyboard", { delay: 50 });
    await page.waitForTimeout(200);

    // Execute
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // Palette should close and cheatsheet should open
    await expect(page.locator(".palette-overlay")).not.toBeVisible();
    await expect(page.locator(".cheatsheet-overlay")).toBeVisible();

    await page.keyboard.press("Escape");
  });
});

test.describe("Feature Highlights", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Jot Deck");
    await page.waitForTimeout(1000);
  });

  test("quick card creation workflow", async ({ page }) => {
    await ensureDeckAndColumn(page);

    // Rapidly create multiple cards
    for (let i = 1; i <= 3; i++) {
      await page.keyboard.press("o");
      await page.waitForTimeout(300);
      await typeInEditor(page, `Quick note ${i}`);
      await saveAndExitEditor(page);
    }

    // Verify cards exist
    await expect(page.locator("text=Quick note 1")).toBeVisible();
    await expect(page.locator("text=Quick note 3")).toBeVisible();

    await page.waitForTimeout(1000);
  });

  test("keyboard navigation demo", async ({ page }) => {
    await ensureDeckAndColumn(page);

    // Create multiple columns
    await page.keyboard.press("Escape");
    await page.keyboard.press("c");
    await page.waitForTimeout(300);
    await page.keyboard.press("c");
    await page.waitForTimeout(300);

    // Add cards to first column
    await page.keyboard.press("g");
    await page.keyboard.press("1");
    await page.waitForTimeout(200);

    await page.keyboard.press("o");
    await page.waitForTimeout(200);
    await typeInEditor(page, "Card A1");
    await saveAndExitEditor(page);

    await page.keyboard.press("o");
    await page.waitForTimeout(200);
    await typeInEditor(page, "Card A2");
    await saveAndExitEditor(page);

    // Navigate with h/j/k/l
    await page.keyboard.press("k");
    await page.waitForTimeout(300);
    await page.keyboard.press("j");
    await page.waitForTimeout(300);
    await page.keyboard.press("l");
    await page.waitForTimeout(300);
    await page.keyboard.press("h");
    await page.waitForTimeout(300);

    // Jump with g+number
    await page.keyboard.press("g");
    await page.keyboard.press("3");
    await page.waitForTimeout(500);

    await page.waitForTimeout(1000);
  });
});
