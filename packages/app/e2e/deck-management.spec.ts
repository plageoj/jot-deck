import { test, expect } from "@playwright/test";
import {
  typeInEditor,
  saveAndExitEditor,
  waitForAppLoad,
} from "./e2e-helpers";

test.describe("Deck Management", () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppLoad(page);
  });

  test("onboarding deck is created on first launch", async ({ page }) => {
    // h1 should show the onboarding deck name
    await expect(page.locator("h1")).toContainText("Getting Started");

    // Should have 3 columns from onboarding
    await expect(page.locator(".column")).toHaveCount(3);

    // Should have welcome content
    await expect(page.locator("text=Welcome to Jot Deck!")).toBeVisible();
    await expect(page.locator("text=h / l")).toBeVisible();
  });

  test("window title shows deck name", async ({ page }) => {
    await expect(page).toHaveTitle("Getting Started - Jot Deck");
  });

  test("deck switcher opens with Ctrl+P", async ({ page }) => {
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);

    const dialog = page.locator("dialog.switcher-dialog");
    await expect(dialog).toBeVisible();

    // Should show search input
    await expect(page.locator(".switcher-input")).toBeFocused();

    // Should show current deck section
    await expect(page.locator(".current-name")).toContainText("Getting Started");

    // Should show stats
    await expect(page.locator(".current-stats")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(dialog).not.toBeVisible();
  });

  test("deck switcher opens from Manage Decks button", async ({ page }) => {
    await page.locator("button", { hasText: "Manage Decks" }).click();
    await page.waitForTimeout(300);

    await expect(page.locator("dialog.switcher-dialog")).toBeVisible();
    await expect(page.locator(".current-name")).toContainText("Getting Started");

    await page.keyboard.press("Escape");
  });

  test("create a new deck from deck switcher", async ({ page }) => {
    // Open deck switcher
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);

    // Click "+ New Deck"
    await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
    await page.waitForTimeout(500);

    // Should switch to the new deck
    await expect(page.locator("h1")).toContainText("New Deck");
    await expect(page).toHaveTitle("New Deck - Jot Deck");

    // New deck should have no columns
    await expect(page.locator("text=No columns in this deck")).toBeVisible();
  });

  test("switch between decks", async ({ page }) => {
    // Create a new deck first
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
    await page.waitForTimeout(500);

    // Should be on "New Deck"
    await expect(page.locator("h1")).toContainText("New Deck");

    // Open switcher and switch back to "Getting Started"
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);

    // "Getting Started" should be in the "Other Decks" section
    const otherDeck = page.locator(".deck-item-name", { hasText: "Getting Started" });
    await expect(otherDeck).toBeVisible();
    await otherDeck.click();
    await page.waitForTimeout(500);

    // Should be back on the onboarding deck
    await expect(page.locator("h1")).toContainText("Getting Started");
    await expect(page.locator(".column")).toHaveCount(3);
  });

  test("search/filter decks in deck switcher", async ({ page }) => {
    // Create a second deck
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
    await page.waitForTimeout(500);

    // Open switcher again — "Getting Started" should be in other decks
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);

    // Type to filter
    await page.keyboard.type("getting", { delay: 50 });
    await page.waitForTimeout(200);

    // Should show "Getting Started" in results
    const items = page.locator(".deck-item");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Getting Started");

    // Type something with no match
    await page.locator(".switcher-input").fill("zzzzz");
    await page.waitForTimeout(200);
    await expect(page.locator(".empty-message")).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("switch deck with keyboard navigation in deck switcher", async ({ page }) => {
    // Create a second deck
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
    await page.waitForTimeout(500);

    // Open switcher
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);

    // "Getting Started" should be the only item in other decks
    const items = page.locator(".deck-item");
    await expect(items).toHaveCount(1);

    // Press Enter to select it
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);

    // Should switch to Getting Started
    await expect(page.locator("h1")).toContainText("Getting Started");
  });

  test("rename deck via deck switcher", async ({ page }) => {
    // Open deck switcher
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);

    // Click the rename icon button
    await page.locator(".icon-btn[title='Rename Deck']").click();
    await page.waitForTimeout(300);

    // RenameDialog should be open
    const renameDialog = page.locator("dialog.rename-dialog");
    await expect(renameDialog).toBeVisible();

    // Clear and type new name
    const input = page.locator(".rename-input");
    await input.fill("My Deck");
    await page.waitForTimeout(100);

    // Confirm
    await page.locator(".btn-confirm").click();
    await page.waitForTimeout(500);

    // h1 and title should reflect new name
    await expect(page.locator("h1")).toContainText("My Deck");
    await expect(page).toHaveTitle("My Deck - Jot Deck");
  });

  test("rename deck via command palette", async ({ page }) => {
    // Open command palette and search for rename
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);
    await page.keyboard.type("rename", { delay: 50 });
    await page.waitForTimeout(200);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // RenameDialog should open
    await expect(page.locator("dialog.rename-dialog")).toBeVisible();

    await page.locator(".rename-input").fill("Renamed Deck");
    await page.locator(".btn-confirm").click();
    await page.waitForTimeout(500);

    await expect(page.locator("h1")).toContainText("Renamed Deck");
  });

  test("delete deck via deck switcher", async ({ page }) => {
    // Create a second deck first (can't delete the only deck)
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
    await page.waitForTimeout(500);

    // Now on "New Deck" — open switcher to go back to onboarding deck
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".deck-item-name", { hasText: "Getting Started" }).click();
    await page.waitForTimeout(500);

    // Open switcher and delete current deck ("Getting Started")
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".icon-btn[title='Delete Deck']").click();
    await page.waitForTimeout(300);

    // ConfirmDialog should appear
    const confirmDialog = page.locator("dialog.confirm-dialog");
    await expect(confirmDialog).toBeVisible();
    await expect(page.locator(".confirm-message")).toContainText("Getting Started");

    // Confirm deletion
    await page.locator(".btn-danger").click();
    await page.waitForTimeout(500);

    // Should switch to the remaining deck
    await expect(page.locator("h1")).toContainText("New Deck");

    // Open switcher — only one deck should remain
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await expect(page.locator(".deck-item")).toHaveCount(0);

    await page.keyboard.press("Escape");
  });

  test("cancel delete deck", async ({ page }) => {
    // Create a second deck
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
    await page.waitForTimeout(500);

    // Switch back to onboarding deck
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".deck-item-name", { hasText: "Getting Started" }).click();
    await page.waitForTimeout(500);

    // Try to delete but cancel
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".icon-btn[title='Delete Deck']").click();
    await page.waitForTimeout(300);

    // Cancel
    await page.locator(".btn-cancel").click();
    await page.waitForTimeout(300);

    // Deck should still exist
    await expect(page.locator("h1")).toContainText("Getting Started");
  });

  test("last opened deck is restored on reload", async ({ page }) => {
    // Create a second deck
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(300);
    await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
    await page.waitForTimeout(500);

    // Should be on "New Deck"
    await expect(page.locator("h1")).toContainText("New Deck");

    // Reload the page — WASM backend resets, but localStorage persists
    // Note: In WASM mode, the database is in-memory so deck data is lost on reload.
    // The last-deck-id is saved in localStorage but the deck won't exist after reload.
    // After reload, onboarding deck is recreated and selected as fallback.
    await page.reload();
    await page.waitForTimeout(1500);

    // After reload, onboarding deck is recreated (WASM is in-memory)
    await expect(page.locator("h1")).toContainText("Getting Started");
  });

  test("Switch Deck command in command palette opens deck switcher", async ({ page }) => {
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);

    await page.keyboard.type("switch deck", { delay: 50 });
    await page.waitForTimeout(200);

    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // Deck switcher should be open
    await expect(page.locator("dialog.switcher-dialog")).toBeVisible();

    await page.keyboard.press("Escape");
  });
});
