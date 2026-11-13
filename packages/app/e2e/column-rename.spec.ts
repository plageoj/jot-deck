import { test, expect, type Page } from "@playwright/test";
import { waitForAppLoad, createFreshDeck } from "./e2e-helpers";

// In-place column rename from the header: the key opens an input in the
// focused column's header, Enter commits through the data layer, and the rename
// is one undoable step.

async function focusedColumnName(page: Page) {
  return page.locator(".column.focused .column-name");
}

test.describe("Column rename in the header", () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppLoad(page);
    await createFreshDeck(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".column.focused")).toHaveCount(1);
  });

  for (const key of ["r", "F2"]) {
    test(`${key} renames the focused column and u undoes it`, async ({ page }) => {
      const name = await focusedColumnName(page);
      const original = await name.innerText();

      await page.keyboard.press(key);
      const input = page.locator(".column.focused .column-name-input");
      await expect(input).toBeFocused();
      await input.fill("Renamed in place");
      await page.keyboard.press("Enter");

      await expect(input).toHaveCount(0);
      await expect(name).toHaveText("Renamed in place");

      await page.keyboard.press("u");
      await expect(name).toHaveText(original);
    });
  }

  test("Escape leaves the name unchanged", async ({ page }) => {
    const name = await focusedColumnName(page);
    const original = await name.innerText();

    await page.keyboard.press("r");
    const input = page.locator(".column.focused .column-name-input");
    await input.fill("Discarded");
    await page.keyboard.press("Escape");

    await expect(input).toHaveCount(0);
    await expect(name).toHaveText(original);
  });
});
