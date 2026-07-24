---
name: run-jot-deck
description: Run, launch, build, drive, or screenshot the Jot Deck app. Use when asked to start Jot Deck, take a screenshot of the UI, verify a frontend change (columns, cards, keybindings, palettes, settings) in the real running app, or drive it headlessly.
---

# Run Jot Deck

Jot Deck is a Tauri v2 desktop app (Rust backend + Svelte 5 / SvelteKit frontend).
Its frontend detects the absence of `__TAURI_INTERNALS__` and **falls back to an
in-browser WASM SQLite backend** (see `docs/004-e2e-testing.md`), so the entire UI
runs in a plain browser — **no Rust / Tauri / webkit2gtk toolchain needed**. That
browser path is the layer nearly every PR here touches (keybindings, palettes,
focus, cards), and it's what this skill drives.

The driver is **`.claude/skills/run-jot-deck/driver.mjs`**: it launches headless
Chromium via Playwright against the running Vite dev server, drives the app with
its real keybindings, and writes a screenshot.

> **Paths below are relative to the repo root** (the `<unit>` for this skill).
> Run everything from there unless noted.

## Scope — what this verifies (and what it does not)

This skill drives the **frontend through the WASM SQLite backend**, which is a
*separate reimplementation* of the Rust backend. Keep that boundary in mind:

- **Covers** (trust a green run here): UI rendering, keybindings, focus model,
  palettes, card/column/deck interactions, settings, tags — the layer most PRs
  touch.
- **Does NOT cover**: the real Rust backend (`crates/core`), Tauri IPC/`invoke`,
  on-disk SQLite/FTS5, and physical-deletion cleanup. A green run here says
  nothing about those. For backend changes, use `cargo test` (in `crates/core`)
  and/or a real desktop build (`pnpm tauri dev`) instead — this skill is a fast
  "see the change in the UI" tool, not a backend/IPC test.

## Prerequisites

- Node (v24 tested) and `pnpm` (v10.33, pinned via `packageManager`).
- No system packages needed for the browser path — headless Chromium is fetched
  by Playwright into `~/.cache/ms-playwright`.

## Build / setup

```bash
pnpm install                                   # from repo root; installs all 3 workspace projects
cd packages/app && pnpm exec playwright install chromium && cd ../..
```

The second command is **required** even if a browser is already cached: the
installed Playwright version pins a specific Chromium build (e.g. `chromium-1228`)
and errors if only an older build is present.

## Run (agent path) — the driver

Start the dev server (leave it running in the background; serves on **:1420**):

```bash
cd packages/app && pnpm dev
```

Then, from the repo root, drive it:

```bash
# create a fresh deck + 3 cards, verify they render, screenshot (default flow)
SHOT=/tmp/jot-deck.png node .claude/skills/run-jot-deck/driver.mjs smoke

# just load the onboarding "Getting Started" deck and screenshot (no writes)
SHOT=/tmp/jot-deck.png node .claude/skills/run-jot-deck/driver.mjs load

# probe whether the CodeMirror editor is in Vim mode
node .claude/skills/run-jot-deck/driver.mjs vim
```

Flows: `smoke` (default), `load`, `vim`. Env vars: `SHOT` (output PNG path,
default `./jot-deck-shot.png`), `BASE_URL` (default `http://localhost:1420`),
`HEADFUL=1` (show the browser — needs a display).

Expected `smoke` output:

```
[driver] app loaded, deck heading = "Getting Started"
[driver] created 3 cards; .card elements on screen = 3
[driver] screenshot written to /tmp/jot-deck.png
```

**Look at the screenshot** — `smoke` shows a "New Deck" with "Column 1" and three
cards; `load` shows the 3-column onboarding deck. A blank page or an error card
means the WASM backend failed to init (see Troubleshooting).

## Vim mode

The CodeMirror editor is **not** in Vim mode by default. `settings.vimEnabled`
defaults to `false` (`packages/app/src/lib/settings.svelte.ts`), and
`CardEditor.svelte` loads the `@replit/codemirror-vim` `vim()` extension only when
that setting is on. New cards open with the editor focused and ready to type
directly — the `vim` driver flow confirms this by finding no fat cursor / vim
panel in the live DOM.

## Run (human path)

`cd packages/app && pnpm dev`, open `http://localhost:1420` in a browser, Ctrl-C to
stop. Useless headless — use the driver instead.

For the **real desktop app** (`pnpm tauri dev`), the Rust/Tauri build needs system
`webkit2gtk`/`libgtk` dev packages. Not exercised by this skill or on headless
Linux; the browser path above covers all frontend work.

## Test / check

```bash
pnpm --filter app test:run    # vitest — 275 tests
pnpm --filter app check       # svelte-check — 0 errors expected
```

## Gotchas

- **New cards open ready to type — do NOT press `i` first.** Sending `i` inserts a
  literal "i" at the start of the card. (The e2e helper's `typeInEditor` presses
  `i`; that's tolerated only because its assertions use substring matches.)
- **`Escape` is intercepted by the app** to close/cancel a card — it is *not* a
  reliable "drop to Vim normal mode" signal. Don't probe Vim mode with it.
- **Screenshots need an explicit `clip`, not full-viewport.** The
  `chromium_headless_shell` fallback build on unofficially-supported Linux
  (Ubuntu 24.04 here) flakily fails default captures with "Unable to capture
  screenshot". The driver's `shoot()` uses a fixed clip + a short retry loop.
- **WASM SQLite is loaded from a CDN** (`https://sql.js.org/dist/sql-wasm.wasm`,
  see `wasm-backend.ts`). The app needs network on first load; offline → blank app.
- **Data is in-memory** in the browser path — a reload starts fresh. The `smoke`
  flow always creates its own clean deck via the deck switcher (`Ctrl+P` →
  "+ New Deck").
- **`pnpm dev` needs port 1420 free** (`strictPort: true`). A stale dev server
  makes a new one exit silently — kill it (`pkill -f 'vite/bin/vite.js'`) first.

## Troubleshooting

- `browserType.launch: Executable doesn't exist … chromium_headless_shell-<n>` →
  run `cd packages/app && pnpm exec playwright install chromium`.
- `Cannot find package '@playwright/test'` → run `pnpm install`; Playwright is a
  devDependency of `packages/app` and is not hoisted to the repo root (the driver
  resolves it from `packages/app/node_modules` on its own).
- Driver hangs at "app loaded" then times out finding cards → the WASM CDN fetch
  is slow/blocked; check network, then retry.
