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
    // Scene 1: Initial app load - create first deck if needed
    // ========================================
    const noDeckMessage = page.locator("text=No decks yet");
    if (await noDeckMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.click("text=Create Deck");
      await page.waitForTimeout(500);
    }

    // ========================================
    // Scene 2: Create columns if needed
    // ========================================
    const noColumnsMessage = page.locator("text=No columns in this deck");
    if (await noColumnsMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.click("text=Create Column");
      await page.waitForTimeout(500);
    }

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

test.describe("Feature Highlights", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Jot Deck");
    await page.waitForTimeout(1000);
  });

  test("quick card creation workflow", async ({ page }) => {
    // Setup
    const noDeckMessage = page.locator("text=No decks yet");
    if (await noDeckMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.click("text=Create Deck");
    }

    const noColumnsMessage = page.locator("text=No columns in this deck");
    if (await noColumnsMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.click("text=Create Column");
    }

    await page.waitForTimeout(500);

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
    // Setup
    const noDeckMessage = page.locator("text=No decks yet");
    if (await noDeckMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.click("text=Create Deck");
    }

    const noColumnsMessage = page.locator("text=No columns in this deck");
    if (await noColumnsMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.click("text=Create Column");
    }

    await page.waitForTimeout(500);

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
