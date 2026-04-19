import { expect, Page } from "@playwright/test";

// Helper to type into CodeMirror Vim editor
// The editor starts in Vim normal mode, so we need to press 'i' to enter insert mode
export async function typeInEditor(page: Page, text: string) {
  // Editor should be focused, press 'i' to enter insert mode
  await page.keyboard.press("i");
  await page.waitForTimeout(100);
  // Type the text
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(100);
}

// Helper to save and exit editor with Ctrl+Enter
export async function saveAndExitEditor(page: Page) {
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(300);
}

// Wait for the app to finish loading (WASM init + onboarding deck creation)
export async function waitForAppLoad(page: Page) {
  await page.goto("/");
  // The h1 shows the current deck name (e.g. "Getting Started" from onboarding)
  await expect(page.locator("h1")).toBeVisible();
  // Wait for WASM SQLite to initialize and data to load
  await page.waitForTimeout(1000);
}

// Create a fresh empty deck and ensure it has at least one column.
// Useful for tests that need a clean slate without onboarding content.
export async function createFreshDeck(page: Page) {
  // Open DeckSwitcher
  await page.keyboard.press("Control+p");
  await page.waitForTimeout(300);

  // Click "+ New Deck"
  await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
  await page.waitForTimeout(500);

  // Now on the new deck with no columns — create one
  const noColumnsMessage = page.locator("text=No columns in this deck");
  if (await noColumnsMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.click("text=Create Column");
    await page.waitForTimeout(500);
  }
}

// Helper to ensure a deck and column exist (idempotent setup)
// With onboarding deck, a deck always exists on first load.
// This creates a fresh deck for a clean test environment.
export async function ensureDeckAndColumn(page: Page) {
  await createFreshDeck(page);
}
