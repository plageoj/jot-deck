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
    const dialog = page.locator("dialog.palette-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".palette-input")).toBeFocused();

    // Verify enabled commands are listed (disabled ones are hidden)
    await expect(page.locator(".palette-item")).toHaveCount(4);

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(dialog).not.toBeVisible();
  });

  test("command palette opens with F1", async ({ page }) => {
    await page.keyboard.press("F1");
    await page.waitForTimeout(300);
    await expect(page.locator("dialog.palette-dialog")).toBeVisible();

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

    // Filter to "new" — matches "New Deck" and "New Column" (multiple results)
    await page.keyboard.type("new", { delay: 50 });
    await page.waitForTimeout(200);

    const items = page.locator(".palette-item");
    expect(await items.count()).toBe(2);

    // First item should be selected by default
    await expect(items.nth(0)).toHaveAttribute("aria-selected", "true");

    // Navigate down
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(items.nth(0)).toHaveAttribute("aria-selected", "false");

    // Navigate back up
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(100);
    await expect(items.nth(0)).toHaveAttribute("aria-selected", "true");

    // Navigate down to "New Column" and execute
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);

    const columnCountBefore = await page.locator(".column").count();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // Palette should be closed and a new column should be created
    await expect(page.locator("dialog.palette-dialog")).not.toBeVisible();
    await expect(page.locator(".column")).toHaveCount(columnCountBefore + 1);
  });

  test("command palette closes when clicking backdrop", async ({ page }) => {
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);
    await expect(page.locator("dialog.palette-dialog")).toBeVisible();

    // Click the dialog element itself (outside the panel) to trigger backdrop close
    const dialog = page.locator("dialog.palette-dialog");
    await dialog.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
    await expect(dialog).not.toBeVisible();
  });

  test("keybinding cheatsheet opens with ? and closes with Escape", async ({ page }) => {
    // Press ? to open cheatsheet
    await page.keyboard.press("Shift+/");
    await page.waitForTimeout(300);

    // Verify cheatsheet is visible
    const overlay = page.locator("dialog.cheatsheet-dialog");
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
    await expect(page.locator("dialog.palette-dialog")).not.toBeVisible();
    await expect(page.locator("dialog.cheatsheet-dialog")).toBeVisible();

    await page.keyboard.press("Escape");
  });
});
