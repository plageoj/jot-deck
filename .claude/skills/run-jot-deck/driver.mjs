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
 *
 * Env:
 *   BASE_URL   dev server URL         (default http://localhost:1420)
 *   SHOT       screenshot output path (default ./jot-deck-shot.png)
 *   HEADFUL    set to "1" to show the browser (needs a display)
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
  // a plain editor; with Vim ON a new card starts in INSERT mode. Either way,
  // do NOT press `i` first — that would insert a literal "i".
  await page.keyboard.type(text, { delay: 25 });
  await sleep(120);
}

async function saveAndExitEditor(page) {
  await page.keyboard.press("Control+Enter");
  await sleep(300);
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
    await sleep(1200); // WASM init + data load
    console.log(`[driver] app loaded, deck heading = "${(await page.locator("h1").first().innerText()).trim()}"`);

    if (flow === "smoke") {
      // Open the deck switcher (Ctrl+P) and create a clean, empty deck.
      await page.keyboard.press("Control+p");
      await sleep(400);
      await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
      await sleep(600);

      // Fresh deck has no columns — create one if prompted.
      const createCol = page.locator("text=Create Column");
      if (await createCol.isVisible({ timeout: 2000 }).catch(() => false)) {
        await createCol.click();
        await sleep(500);
      }
      await page.keyboard.press("Escape");
      await sleep(300);

      // Create three cards with `o` (new card -> editor -> save).
      const notes = ["Write at the speed of thought #demo", "Keyboard-first, Vim-style", "Local-first, crystallize with AI"];
      for (const note of notes) {
        await page.keyboard.press("o");
        await sleep(400);
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
      // Ensure a column exists, then open a new card to focus the editor.
      await page.keyboard.press("Control+p");
      await sleep(400);
      await page.locator(".footer-btn", { hasText: "+ New Deck" }).click();
      await sleep(600);
      const createCol = page.locator("text=Create Column");
      if (await createCol.isVisible({ timeout: 2000 }).catch(() => false)) {
        await createCol.click();
        await sleep(500);
      }
      await page.keyboard.press("Escape");
      await sleep(300);
      await page.keyboard.press("o");
      await sleep(500);

      // Vim is setting-gated: CardEditor loads the @replit/codemirror-vim
      // `vim()` extension only when settings.vimEnabled is true (default false,
      // see packages/app/src/lib/settings.svelte.ts). When it's on, the editor
      // renders a fat block cursor and (in command mode) a .cm-vim-panel.
      // NOTE: don't use Escape to probe normal mode here — the app intercepts
      // Escape to close the card, so it can't be used as a vim-mode signal.
      const dom = await page.evaluate(() => ({
        hasEditor: !!document.querySelector(".cm-editor"),
        fatCursor: document.querySelectorAll(".cm-fat-cursor").length,
        vimPanel: document.querySelectorAll(".cm-vim-panel").length,
      }));
      const vimActive = dom.fatCursor > 0 || dom.vimPanel > 0;
      console.log(`[driver] editor present : ${dom.hasEditor}`);
      console.log(`[driver] vim DOM markers: fatCursor=${dom.fatCursor} vimPanel=${dom.vimPanel}`);
      console.log(`[driver] VIM MODE = ${vimActive ? "ON" : "OFF (plain CodeMirror; enable in Settings)"}`);
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
