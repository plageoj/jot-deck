import { test, expect } from "@playwright/test";
import { waitForAppLoad } from "./e2e-helpers";

// Browser-only handling of desktop features (docs/009-web-demo.md §4–§6). These
// apply to every browser run, not just the demo build. Each test only checks
// that the real isTauri() detection takes the browser branch; the branch
// contents are covered by the component tests.
test.describe("Browser runtime", () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppLoad(page);
  });

  test("no demo banner outside the demo build", async ({ page }) => {
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    await expect(page).toHaveTitle("Getting Started - Jot Deck");
  });

  test("Reporters point to the desktop app", async ({ page }) => {
    await page.keyboard.press("g");
    await page.keyboard.press("r");

    const dialog = page.locator("dialog.reporters-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Available in the desktop app.");
  });

  test("deck switcher has no MCP config or deck id copy", async ({ page }) => {
    await page.keyboard.press("Control+p");

    await expect(page.locator(".current-name")).toContainText("Getting Started");
    await expect(page.getByRole("button", { name: "Copy MCP server config" })).toHaveCount(0);
  });

  test("About has no update check", async ({ page }) => {
    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: /About/ }).click();

    const dialog = page.locator("dialog.about-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Check for Updates" })).toHaveCount(0);
  });

  test("cheatsheet dims browser-reserved keys", async ({ page }) => {
    await page.keyboard.press("Shift+/");

    const palette = page.locator(".cheatsheet-item").filter({ hasText: "Command palette" });
    await expect(palette.locator("kbd.unavailable")).toHaveText(["Ctrl+Shift+P"]);
  });
});

test.describe("Touch device", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("explains the app is keyboard-driven, then lets the board through", async ({ page }) => {
    await page.goto("/");

    const notice = page.locator("dialog.touch-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Jot Deck is keyboard-driven.");

    await notice.getByRole("button", { name: "Continue anyway" }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.locator("h1")).toContainText("Getting Started");
  });
});
