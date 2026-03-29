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

// Helper to ensure a deck and column exist (idempotent setup)
export async function ensureDeckAndColumn(page: Page) {
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
