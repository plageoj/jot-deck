#!/usr/bin/env node
/**
 * Jot Deck driver — launches the SvelteKit frontend in headless Chromium
 * (via Playwright) against the running Vite dev server, drives it with the
 * app's real Vim/Twitter keybindings, and takes a screenshot.
 *
 * Jot Deck is a Tauri desktop app, but its frontend detects the absence of
 * `__TAURI_INTERNALS__` and falls back to an in-browser WASM SQLite backend
 * (see docs/004-e2e-testing.md). That means the whole UI runs in a plain
 * browser with no Rust/Tauri/webkit2gtk toolchain — which is the layer almost
 * every PR here touches (keybindings, palettes, focus, cards).
 *
 * Prereq: a dev server must already be running on BASE_URL. Start it with:
 *     (cd packages/app && pnpm dev)
 *
 * Usage (from the repo root):
 *     node .claude/skills/run-jot-deck/driver.mjs [flow]
 *
 *   flow = "smoke" (default) — create a fresh deck, add 3 cards, verify + shot
 *   flow = "load"            — just load the app and screenshot (no writes)
 *   flow = "vim"             — probe whether the CodeMirror editor is in Vim mode
 *
 * Env:
 *   BASE_URL   dev server URL         (default http://localhost:1420)
 *   SHOT       screenshot output path (default ./jot-deck-shot.png)
 *   HEADFUL    set to "1" to show the browser (needs a display)
 *   VIM        set to "1" to turn on Vim mode via the Settings dialog first
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// repo root = <root>/.claude/skills/run-jot-deck -> up 3
const repoRoot = resolve(here, "..", "..", "..");
const appDir = resolve(repoRoot, "packages", "app");

// Playwright is a devDependency of packages/app and is NOT hoisted to the repo
// root, so resolve it explicitly from the app's node_modules.
const appRequire = createRequire(resolve(appDir, "package.json"));
const { chromium } = appRequire("@playwright/test");

const BASE_URL = process.env.BASE_URL || "http://localhost:1420";
const SHOT = process.env.SHOT || resolve(process.cwd(), "jot-deck-shot.png");
const HEADFUL = process.env.HEADFUL === "1";
const VIM = process.env.VIM === "1";
const flow = process.argv[2] || "smoke";

const VIEWPORT = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The chromium_headless_shell fallback build used on unofficially-supported
// Linux (e.g. Ubuntu 24.04) flakily fails a capture with "Unable to capture
// screenshot", especially on the first attempt against a content-heavy page.
// An explicit clip (not full-viewport) plus a short retry is reliable.
async function shoot(page, path) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      await page.screenshot({ path, clip: { x: 0, y: 0, ...VIEWPORT } });
      return;
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  throw lastErr;
}

async function typeInEditor(page, text) {
  // A new card opens with the CodeMirror editor focused and ready for input, so
  // type straight in. With Vim OFF (the default, settings.vimEnabled=false) it's
  // a plain editor; with Vim ON the editor opens in INSERT mode. Either way,
  // do NOT press `i` first — that would insert a literal "i".
  await page.keyboard.type(text, { delay: 25 });
  await sleep(120);
}

async function saveAndExitEditor(page) {
  await page.keyboard.press("Control+Enter");
  // The editor detaches once the card is saved; wait for that instead of a
  // blind delay so the next `o` doesn't race the still-open editor. A failed
  // save keeps the editor open, so a timeout here is a real failure.
  await page.locator(".cm-editor").waitFor({ state: "hidden", timeout: 5000 });
}

// Open the deck switcher and create a clean, empty deck with one column.
// NOTE: these selectors/keybindings mirror packages/app/e2e/e2e-helpers.ts —
// that file is the source of truth. If the app renames a button or changes a
// keybinding, update both. (This standalone .mjs can't import the .ts helper.)
async function createFreshDeckWithColumn(page) {
  await page.keyboard.press("Control+p");
  // .click() auto-waits for the switcher and button to be actionable.
  await page.locator(".palette-item", { hasText: "New deck" }).click();
  // A fresh deck has no columns — create one if prompted (the check's own
  // timeout covers the deck-switch render, so no fixed sleep needed).
  const createCol = page.locator("text=Create Column");
  if (await createCol.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createCol.click();
  }
  await page.keyboard.press("Escape"); // leave any palette -> column focus
}

// Settings live in the (in-memory) DB, not localStorage, so they can't be
// seeded before load — flip the checkbox in the Settings dialog instead. The
// change applies to editors opened afterwards. Open/close it with the keyboard
// (Ctrl+, / Escape): closing via the × button leaves focus on the header's
// Settings button, and the app's keybindings (`o`, `j`, ...) then stop firing.
async function enableVim(page) {
  await page.keyboard.press("Control+,");
  const box = page.locator("#settings-vim");
  if (!(await box.isChecked())) await box.check();
  await page.keyboard.press("Escape");
  await box.waitFor({ state: "hidden", timeout: 5000 });
  console.log("[driver] Vim mode enabled via Settings");
}

async function main() {
  console.log(`[driver] flow=${flow} base=${BASE_URL} headful=${HEADFUL}`);
  const browser = await chromium.launch({ headless: !HEADFUL });
  const page = await browser.newPage({ viewport: VIEWPORT });

  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[page:error] ${m.text()}`);
  });

  let ok = true;
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
    // The h1 shows the current deck name once WASM SQLite + onboarding load.
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 20000 });
    // Gate on real readiness (the onboarding deck's first column rendering)
    // rather than a blind delay, so this is robust across warm/cold WASM starts.
    await page.locator(".column").first().waitFor({ state: "visible", timeout: 20000 });
    console.log(`[driver] app loaded, deck heading = "${(await page.locator("h1").first().innerText()).trim()}"`);

    if (VIM) await enableVim(page);

    if (flow === "smoke") {
      await createFreshDeckWithColumn(page);

      // Create three cards with `o` (new card -> editor -> save).
      const notes = ["Write at the speed of thought #demo", "Keyboard-first, Vim-style", "Local-first, crystallize with AI"];
      for (const note of notes) {
        await page.keyboard.press("o");
        await page.locator(".cm-editor").waitFor({ state: "visible", timeout: 5000 });
        await typeInEditor(page, note);
        await saveAndExitEditor(page);
      }

      // Verify the cards rendered.
      for (const note of notes) {
        await page.locator(`text=${note}`).first().waitFor({ state: "visible", timeout: 5000 });
      }
      const cardCount = await page.locator(".card").count();
      console.log(`[driver] created ${notes.length} cards; .card elements on screen = ${cardCount}`);
    }

    if (flow === "vim") {
      // Open a new card to focus the editor, then probe its mode.
      await createFreshDeckWithColumn(page);
      await page.keyboard.press("o");
      await page.locator(".cm-editor").waitFor({ state: "visible", timeout: 5000 });

      // Vim is setting-gated: CardEditor loads the @replit/codemirror-vim
      // `vim()` extension only when settings.vimEnabled is true (default false,
      // see packages/app/src/lib/settings.svelte.ts). The editor opens in
      // INSERT mode (thin cursor, no .cm-fat-cursor), so the reliable marker
      // is the vim cursor layer, which the extension always renders.
      const vimMarkers = () =>
        page.evaluate(() => ({
          cursorLayer: document.querySelectorAll(".cm-vimCursorLayer").length,
          fatCursor: document.querySelectorAll(".cm-fat-cursor").length,
        }));
      const dom = await vimMarkers();
      const vimActive = dom.cursorLayer > 0;
      console.log(`[driver] vim DOM markers: vimCursorLayer=${dom.cursorLayer} fatCursor=${dom.fatCursor}`);
      console.log(`[driver] VIM MODE = ${vimActive ? "ON (Insert)" : "OFF (plain CodeMirror; rerun with VIM=1)"}`);

      if (vimActive) {
        // With Vim ON, Escape drops to Normal mode (fat cursor) and keeps the
        // editor open. With Vim OFF, Escape closes the card instead — and an
        // empty new card is discarded.
        await page.keyboard.press("Escape");
        await page.locator(".cm-fat-cursor").first().waitFor({ state: "attached", timeout: 3000 });
        console.log("[driver] Escape -> Vim NORMAL mode (fat cursor), editor still open");
      }
    }

    await shoot(page, SHOT);
    console.log(`[driver] screenshot written to ${SHOT}`);
  } catch (err) {
    ok = false;
    console.error(`[driver] FAILED: ${err.message}`);
    await shoot(page, SHOT).catch(() => {});
    console.error(`[driver] failure screenshot written to ${SHOT}`);
  } finally {
    await browser.close();
  }
  process.exit(ok ? 0 : 1);
}

main();
