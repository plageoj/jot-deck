import { test, expect } from "@playwright/test";
import {
  typeInEditor,
  saveAndExitEditor,
  waitForAppLoad,
  ensureDeckAndColumn,
} from "./e2e-helpers";

// Card focus Ctrl+c / Ctrl+x / Ctrl+v against the system clipboard. Ctrl+v
// relies on the browser firing a native `paste` event while no editable
// element is focused, which only a real browser can confirm.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.describe("System clipboard", () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppLoad(page);
    await ensureDeckAndColumn(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    // Leave card focus on a single card
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Anchor card");
    await saveAndExitEditor(page);
  });

  test("Ctrl+v pastes external multi-line text as one card", async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText("From outside\r\nsecond line"));

    await page.keyboard.press("Control+v");

    const cards = page.locator(".card-content");
    await expect(cards).toHaveCount(2, { timeout: 5000 });
    await expect(cards.nth(1)).toContainText("From outside");
    await expect(cards.nth(1)).toContainText("second line");
  });

  test("Ctrl+c copies card text and Ctrl+x removes the card", async ({ page }) => {
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Anchor card");

    await page.evaluate(() => navigator.clipboard.writeText(""));
    await page.keyboard.press("Control+x");
    await expect(page.locator(".card-content")).toHaveCount(0, { timeout: 5000 });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Anchor card");
  });
});
