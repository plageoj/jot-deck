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
  and/or a real desktop build (`pnpm --filter app tauri dev`) instead — this skill is a fast
  "see the change in the UI" tool, not a backend/IPC test.

## Prerequisites

- Node (v24 on Ubuntu 24.04 and v26 on Windows 11 / Git Bash tested) and `pnpm`
  (v12.10, pinned via `packageManager`).
- No system packages needed for the browser path — headless Chromium is fetched
  by Playwright into its cache (`~/.cache/ms-playwright` on Linux,
  `%LOCALAPPDATA%\ms-playwright` on Windows).
- The sql.js WASM binary is served by Vite from the installed `sql.js` package
  (no CDN fetch at runtime).

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

# probe whether the CodeMirror editor is in Vim mode (expect OFF by default)
SHOT=/tmp/jot-deck.png node .claude/skills/run-jot-deck/driver.mjs vim

# same flows with Vim mode turned on first (via Ctrl+, -> checkbox -> Escape)
VIM=1 SHOT=/tmp/jot-deck.png node .claude/skills/run-jot-deck/driver.mjs vim
VIM=1 SHOT=/tmp/jot-deck.png node .claude/skills/run-jot-deck/driver.mjs smoke
```

Flows: `smoke` (default), `load`, `vim`. Env vars: `SHOT` (output PNG path,
default `./jot-deck-shot.png` — i.e. the repo root, so always pass `SHOT`),
`BASE_URL` (default `http://localhost:1420`), `HEADFUL=1` (show the browser —
needs a display), `VIM=1` (enable Vim mode in Settings before the flow).
`/tmp/...` works in Git Bash on Windows too (it maps to `%TEMP%`).

Expected `smoke` output:

```
[driver] app loaded, deck heading = "Getting Started"
[driver] created 3 cards; .card elements on screen = 3
[driver] screenshot written to /tmp/jot-deck.png
```

Expected `VIM=1 … vim` output:

```
[driver] Vim mode enabled via Settings
[driver] vim DOM markers: vimCursorLayer=1 fatCursor=0
[driver] VIM MODE = ON (Insert)
[driver] Escape -> Vim NORMAL mode (fat cursor), editor still open
```

**Look at the screenshot** — `smoke` shows a "New Deck" with "Column 1" (with a
`1` kbd hint in the header) and three cards; `load` shows the 3-column
onboarding deck; `VIM=1 vim` shows an empty card with a block cursor. A blank page or an error card
means the WASM backend failed to init (see Troubleshooting).

## Vim mode

The CodeMirror editor is **not** in Vim mode by default. `settings.vimEnabled`
defaults to `false` (`packages/app/src/lib/settings.svelte.ts`), and
`CardEditor.svelte` loads the `@replit/codemirror-vim` `vim()` extension only when
that setting is on. Settings are stored in the (in-memory) DB, so they can't be
seeded via localStorage — `VIM=1` flips the checkbox in the Settings dialog.

With Vim on, the editor always opens in **Insert** mode (new cards, and `i`/`a`
on an existing card — `i`/`I`/`Enter` put the cursor at the start or the
remembered position, `a`/`A` at the end). Insert mode has a thin cursor, so
`.cm-fat-cursor` is absent; the reliable "Vim is loaded" marker is
`.cm-vimCursorLayer`. `.cm-fat-cursor` appears only after `Escape` (Normal mode).

## Run (human path)

`cd packages/app && pnpm dev`, open `http://localhost:1420` in a browser, Ctrl-C to
stop. Useless headless — use the driver instead.

For the **real desktop app** (`pnpm --filter app tauri dev`; note the root `pnpm dev`
only starts Vite), the
Rust build also stages the `jot-deck-mcp` sidecar via `beforeDevCommand` (see
`CLAUDE.md`), and on Linux needs `webkit2gtk`/`libgtk` dev packages. Not
exercised by this skill; the browser path above covers all frontend work.

## Test / check

```bash
pnpm --filter app test:run    # vitest — 27 files / 533 tests passing at time of writing (~35s)
pnpm --filter app check       # svelte-check — 0 errors, 0 warnings expected
```

## Gotchas

- **New cards open ready to type — do NOT press `i` first.** Sending `i` inserts a
  literal "i" at the start of the card. (The e2e helper's `typeInEditor` presses
  `i`; that's tolerated only because its assertions use substring matches.)
- **`Escape` means different things depending on Vim mode.** Vim off: it closes
  the editor, and a brand-new card that is still empty is *discarded* (no card
  is left behind). Vim on: the first `Escape` only drops Insert → Normal and
  the editor stays open. Use `Ctrl+Enter` to save in both modes.
- **Close dialogs with `Escape`, not the × button.** Closing Settings via
  `.close-btn` leaves focus on the header's "Settings" button, and the app's
  single-key bindings (`o`, `j`, `k`, …) silently stop working until something
  else takes focus. `Ctrl+P` / `Ctrl+,` still work from there.
- **`getByRole("button", { name: "Settings" })` is ambiguous** — columns and
  cards are `role="button"` too, and onboarding cards mention "Settings". Use
  the header button's aria-label `"Open settings"` or the `Ctrl+,` shortcut.
- **Screenshots need an explicit `clip`, not full-viewport.** The
  `chromium_headless_shell` fallback build on unofficially-supported Linux
  (Ubuntu 24.04 here) flakily fails default captures with "Unable to capture
  screenshot". The driver's `shoot()` uses a fixed clip + a short retry loop.
- **The WASM binary must match the installed `sql.js` JS glue.**
  `wasm-backend.ts` imports `sql.js/dist/sql-wasm-browser.wasm?url`, so both
  come from `node_modules`. A blank app with
  `LinkError: … function import requires a callable` in `[page:error]` means
  they diverged — rerun `pnpm install`.
- **First `pnpm dev` after a dependency change is slow** (~20s: "Re-optimizing
  dependencies because vite config has changed"). Wait for `Local:
  http://localhost:1420/` in its output before running the driver.
- **Data is in-memory** in the browser path — a reload starts fresh. The `smoke`
  flow always creates its own clean deck via the deck switcher (`Ctrl+P` →
  "New deck").
- **`pnpm dev` needs port 1420 free** (`strictPort: true`). A stale dev server
  makes a new one exit silently — kill it first. Linux:
  `pkill -f 'vite/bin/vite.js'`. Windows (Git Bash):
  `netstat -ano | grep ':1420 .*LISTENING'` → `taskkill //PID <pid> //T //F`.

## Troubleshooting

- `browserType.launch: Executable doesn't exist … chromium_headless_shell-<n>` →
  run `cd packages/app && pnpm exec playwright install chromium`.
- `Cannot find package '@playwright/test'` → run `pnpm install`; Playwright is a
  devDependency of `packages/app` and is not hoisted to the repo root (the driver
  resolves it from `packages/app/node_modules` on its own).
- `VIM=1` run fails with `strict mode violation: getByRole('button', { name:
  'Settings' }) resolved to 4 elements` → a local edit reintroduced the
  name-based selector; use `Ctrl+,` (see Gotchas).
- `FAILED: VIM=1 was set but the editor has no .cm-vimCursorLayer` (exit 1) →
  the Settings toggle didn't reach the editor: check the `#settings-vim`
  checkbox and that `CardEditor.svelte` still loads `vim()` when
  `settings.vimEnabled` is true.
- `locator.waitFor: … waiting for locator('.cm-editor')` right after a dialog
  was closed → focus is stuck on a header button; close dialogs with `Escape`.
