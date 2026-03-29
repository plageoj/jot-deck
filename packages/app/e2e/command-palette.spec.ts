import { test, expect } from "@playwright/test";
import {
  typeInEditor,
  saveAndExitEditor,
  ensureDeckAndColumn,
} from "./e2e-helpers";

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
