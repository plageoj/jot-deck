import { test, expect } from "@playwright/test";
import {
  typeInEditor,
  saveAndExitEditor,
  waitForAppLoad,
  ensureDeckAndColumn,
} from "./e2e-helpers";

test.describe("Tag Features", () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppLoad(page);
    await ensureDeckAndColumn(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  test("tags are highlighted in card view mode", async ({ page }) => {
    // Create a card with tags
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Hello #world and #test");
    await saveAndExitEditor(page);

    // Verify the card content is visible (not editing anymore)
    await expect(page.locator("text=Hello")).toBeVisible({ timeout: 5000 });

    // Verify tag elements are rendered with .tag class
    const tags = page.locator(".card-content button.tag");
    await expect(tags).toHaveCount(2, { timeout: 5000 });
    await expect(tags.nth(0)).toContainText("#world");
    await expect(tags.nth(1)).toContainText("#test");
  });

  test("clicking a tag activates filter", async ({ page }) => {
    // Create cards — one with a tag, one without
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Tagged card #important");
    await saveAndExitEditor(page);

    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Untagged card");
    await saveAndExitEditor(page);

    // Verify card content is visible
    await expect(page.locator("button.tag", { hasText: "#important" })).toBeVisible({ timeout: 5000 });

    // Click the #important tag
    await page.locator("button.tag", { hasText: "#important" }).click();
    await page.waitForTimeout(300);

    // Verify filter bar appears
    const filterBar = page.locator(".tag-filter-bar");
    await expect(filterBar).toBeVisible();
    await expect(filterBar).toContainText("#important");

    // Verify untagged card is dimmed
    const dimmedCards = page.locator(".card.dimmed");
    expect(await dimmedCards.count()).toBeGreaterThan(0);

    // The tagged card should NOT be dimmed
    const taggedCard = page.locator(".card", { hasText: "#important" });
    await expect(taggedCard).not.toHaveClass(/dimmed/);
  });

  test("filter can be cleared from filter bar", async ({ page }) => {
    // Create a card with a tag
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Note #project");
    await saveAndExitEditor(page);

    // Wait for content to render and activate filter by clicking tag
    await expect(page.locator("button.tag", { hasText: "#project" })).toBeVisible({ timeout: 5000 });
    await page.locator("button.tag", { hasText: "#project" }).click();
    await page.waitForTimeout(300);

    // Verify filter bar is shown
    await expect(page.locator(".tag-filter-bar")).toBeVisible();

    // Clear the filter using the close button
    await page.locator(".filter-clear").click();
    await page.waitForTimeout(300);

    // Verify filter bar is gone
    await expect(page.locator(".tag-filter-bar")).not.toBeVisible();

    // Verify no cards are dimmed
    await expect(page.locator(".card.dimmed")).toHaveCount(0);
  });

  test("tag palette opens with / key and filters tags", async ({ page }) => {
    // Create cards with different tags
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "#alpha note");
    await saveAndExitEditor(page);

    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "#beta note");
    await saveAndExitEditor(page);

    // Exit to column mode to use / key
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Press / to open tag palette
    await page.keyboard.press("/");
    await page.waitForTimeout(500);

    // Verify palette dialog opens
    const dialog = page.locator("dialog.palette-dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Should show both tags
    const items = page.locator(".palette-item");
    await expect(items).toHaveCount(2);

    // Type to filter
    await page.keyboard.type("alp", { delay: 50 });
    await page.waitForTimeout(200);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("#alpha");

    // Select with Enter to activate filter
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // Verify palette closed and filter bar appeared
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".tag-filter-bar")).toBeVisible();
    await expect(page.locator(".tag-filter-bar")).toContainText("#alpha");
  });

  test("tag palette opens with / in card mode too", async ({ page }) => {
    // Create a card with a tag so we can be in card mode
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "#gamma data");
    await saveAndExitEditor(page);

    // We should be in card mode after save
    // Press / to open tag palette
    await page.keyboard.press("/");
    await page.waitForTimeout(300);

    await expect(page.locator("dialog.palette-dialog")).toBeVisible();

    // Close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  test("tag palette shows empty message when no tags exist", async ({
    page,
  }) => {
    // No cards with tags — just open the palette
    await page.keyboard.press("/");
    await page.waitForTimeout(300);

    await expect(page.locator("dialog.palette-dialog")).toBeVisible();
    await expect(page.locator(".palette-empty")).toContainText(
      "No tags in this deck",
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  test("tag filter via command palette", async ({ page }) => {
    // Create a card with a tag
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "#workflow idea");
    await saveAndExitEditor(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Open command palette and search for "filter"
    await page.keyboard.press("Control+Shift+p");
    await page.waitForTimeout(300);
    await page.keyboard.type("filter by", { delay: 50 });
    await page.waitForTimeout(200);

    // Should find the "Filter by Tag" command
    const items = page.locator(".palette-item");
    await expect(items.first()).toContainText("Filter by Tag");

    // Execute it
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    // Tag palette should now be open
    await expect(page.locator("dialog.palette-dialog")).toBeVisible();
    await expect(page.locator(".palette-item")).toHaveCount(1);
    await expect(page.locator(".palette-item").first()).toContainText(
      "#workflow",
    );

    await page.keyboard.press("Escape");
  });

  test("active tag is visually highlighted in card view", async ({ page }) => {
    // Create a card with a tag
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Check #active tag");
    await saveAndExitEditor(page);

    // Click the tag to activate filter
    await page.locator(".tag", { hasText: "#active" }).click();
    await page.waitForTimeout(300);

    // The tag should now have the active class
    const activeTag = page.locator(".tag.tag-active");
    await expect(activeTag).toHaveCount(1);
    await expect(activeTag).toContainText("#active");
  });

  test("multiple tags in a single card are all highlighted", async ({
    page,
  }) => {
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "#one #two #three");
    await saveAndExitEditor(page);

    const tags = page.locator(".card-content .tag");
    await expect(tags).toHaveCount(3);
    await expect(tags.nth(0)).toContainText("#one");
    await expect(tags.nth(1)).toContainText("#two");
    await expect(tags.nth(2)).toContainText("#three");
  });

  test("tag autocomplete shows suggestions in editor", async ({ page }) => {
    // First create a card with a tag to seed the suggestions database
    await page.keyboard.press("o");
    await page.waitForTimeout(300);
    await typeInEditor(page, "Seed #suggestion_tag");
    await saveAndExitEditor(page);

    // Create another card and type a tag prefix
    await page.keyboard.press("o");
    await page.waitForTimeout(300);

    // Enter insert mode and type #sug to trigger autocomplete
    await page.keyboard.press("i");
    await page.waitForTimeout(100);
    await page.keyboard.type("#sug", { delay: 80 });
    await page.waitForTimeout(500);

    // Check if autocomplete tooltip appears
    const tooltip = page.locator(".cm-tooltip-autocomplete");
    await expect(tooltip).toBeVisible({ timeout: 3000 });
    await expect(tooltip).toContainText("#suggestion_tag");

    // Accept with Tab
    await page.keyboard.press("Tab");
    await page.waitForTimeout(200);

    // Save and verify the full tag was inserted
    await saveAndExitEditor(page);

    await expect(
      page.locator(".tag", { hasText: "#suggestion_tag" }),
    ).toHaveCount(2);
  });
});
