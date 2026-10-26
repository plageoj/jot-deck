# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jot Deck is a keyboard-centric, local-first note-taking app with a TweetDeck-style column UI. It uses Tauri v2 (Rust backend) with a Svelte 5 + TypeScript frontend. The app is designed for power users who want to capture ideas quickly using Vim-style keybindings.

## Commands

### Development
```bash
pnpm install          # Install dependencies
pnpm tauri dev        # Start the desktop app (Tauri + Vite dev server)
pnpm dev              # Start only the Vite dev server (frontend on :1420, WASM SQLite backend in the browser)
pnpm web:dev          # Start landing page dev server
```

When starting work in a fresh worktree, run `pnpm install` from the repository root before working with the app or web packages so workspace dependencies are available.

### Testing
```bash
pnpm --filter app test        # Run frontend tests in watch mode
pnpm --filter app test:run    # Run frontend tests once
pnpm --filter app test:e2e    # Run Playwright E2E tests (browser + WASM SQLite, see docs/004)
```

To launch and drive the app headlessly (screenshots, keybinding checks), use the
`run-jot-deck` skill (`.claude/skills/run-jot-deck/`).

### Building
```bash
pnpm tauri build      # Build the Tauri desktop app
pnpm build            # Build only the frontend (Vite)
pnpm web:build        # Build landing page
```

### Type Checking
```bash
pnpm --filter app check       # Run svelte-check
```

### Rust (Cargo workspace at the repository root)
```bash
cargo check --workspace                                              # Type check all crates (needs the staged MCP sidecar, see below)
cargo test -p jot-deck-core -p jot-deck-mcp -p jot-deck-reporter-host  # Run Rust tests
cargo run -p jot-deck-core --bin jot-deck-cli -- <db-path>           # Interactive REPL against a DB file (data-layer debugging)
```

### MCP bridge (read/write Deck access for external agents)
```bash
cargo run -p jot-deck-mcp
```
Optional environment variables (all unset by default):
- `JOT_DECK_DECK_ID` — pins the connection to one Deck; unset, any local Deck is addressed via a `deck_id` argument per call
- `JOT_DECK_DB_PATH` — overrides the DB path
- `JOT_DECK_DENY` — comma list of write capabilities to disable (`append`, `edit`, `delete`, `structure`)
- `JOT_DECK_MAX_WRITES_PER_MIN` — per-connection write rate cap (default 120)
- `JOT_DECK_WRITE_COLUMNS` — comma list of column ids writes are restricted to (also disables `ensure_column` creation)

Speaks JSON-RPC 2.0 over stdio. Read tools: `list_decks`, `describe_deck`, `list_columns`,
`read_card`, `search_cards`, `recent_cards`; write tools: `append_card`, `patch_card`,
`move_card`, `delete_card`, `ensure_column`, `update_column`, `move_column`.
Spawned by an MCP host (Claude Desktop / Claude Code)
via its `mcpServers` config. The bridge derives the DB path from the fixed app data
dir (same as the GUI), so no environment variables are required. In production the bridge ships
as a Tauri sidecar (`externalBin`); the GUI Deck switcher generates a paste-ready config
snippet ("Copy MCP server config") and can also copy just the deck id ("Deck id").

The sidecar is staged by `scripts/build-mcp-sidecar.mjs` (run via `pnpm --filter app
build:mcp-sidecar`, and automatically from `beforeBuildCommand`). **Run it once before
`cargo check`/`cargo build` on `packages/app/src-tauri`** — `externalBin` fails the build
if the staged binary is missing. `beforeDevCommand` passes `--debug` so `pnpm tauri dev` builds
the sidecar with the debug profile and reuses the app's debug dependency artifacts; the
script locates the output via `cargo metadata`, so `CARGO_TARGET_DIR` is honored.

To share Rust compile artifacts across worktrees, install sccache
(`cargo binstall sccache`) and set `RUSTC_WRAPPER=sccache` in your user environment.
Each worktree keeps its own `target/`, so Rust build artifacts do not collide. Parallel
`pnpm tauri dev` runs still clash on the fixed dev port 1420 (`devUrl` in `tauri.conf.json`,
`strictPort` in Vite), so run only one at a time.

## Architecture

### Monorepo Structure
- `packages/app/` - Tauri application (SvelteKit frontend + Rust backend)
- `packages/web/` - Landing page (Astro, deployed to Cloudflare Pages)
- `crates/core/` - Rust core library (SQLite/FTS5 database, models, repositories) plus the `jot-deck-cli` debug REPL
- `crates/mcp/` - stdio MCP bridge server exposing Deck reads and writes (links `jot-deck-core`, opens the DB directly). See `docs/008-mcp-server.md`.
- `crates/reporter-host/` - Transport-agnostic Reporter host: JSON-RPC dispatch onto `jot-deck-core` and per-Reporter scope. The Tauri layer spawns Reporters and pumps stdio. See `docs/007-reporter-protocol.md`.

### Frontend (packages/app/src)
- **Components** (`src/lib/components/`): Deck, Column, Card, CardEditor (CodeMirror 6, optional Vim mode), VirtualList, palettes (Command/Column/Tag/Trash, DeckSwitcher) and dialogs (Settings, Keybindings, Reporters, About)
- **Types** (`src/lib/types.ts`): TypeScript interfaces mirroring Rust models (Deck, Column, Card)
- **DB backends** (`src/lib/db/`): `tauri-backend.ts` (Tauri `invoke` into the Rust core) and `wasm-backend.ts` (sql.js WASM SQLite, used automatically when not running inside Tauri — browser dev and E2E)
- **Keybindings** (`src/lib/keybindings.ts`, `keyProcessor.ts`): Vim+Twitter-style keybinding system with focus modes (column/card/edit/command) and user overrides
- **State & actions**: `deckData.svelte.ts` (deck data), `focusManager.svelte.ts` (focus state), `actionDispatcher.svelte.ts` + `boardActionExecutors.ts` (keybinding actions), `cardEditSessions.ts` (edit sessions), `settings.svelte.ts` (settings persisted in the DB)
- **Undo Stack** (`src/lib/undoStack.ts`): Session-scoped undo/redo of board operations

### Backend (crates/core)
- `models.rs` - Data models: Deck, Column, Card, Tag with ULID IDs
- `db.rs` - SQLite connection setup (file-based or in-memory)
- `repository/` - CRUD operations for each entity (deck, column, card, tag, setting), plus the deck-scoped `query` (reads) / `write` (writes) layer and `deck_scope` resolution shared by the MCP bridge and the Reporter host
- `cleanup.rs` - Physical deletion of soft-deleted items after 30 days

### Tauri Bridge (packages/app/src-tauri)
- Exposes `jot-deck-core` functionality to the frontend via Tauri commands
- Uses `jot-deck-core` and `jot-deck-reporter-host` as dependencies; `reporter.rs` spawns Reporters and forwards change events to the frontend
- Bundles the `jot-deck-mcp` binary as a sidecar (`externalBin`)

### Focus Model
The app has four focus modes that determine keybinding behavior:
1. **Column focus** - Navigate/reorder columns, create cards
2. **Card focus** - Navigate/reorder/delete cards, enter edit mode
3. **Edit focus** - CodeMirror editor active for text editing (Vim mode when enabled in Settings)
4. **Command focus** - Command palette active

### Key Design Patterns
- Soft deletion with `deleted_at` timestamps; physical deletion after 30 days
- Position-based ordering for columns and cards
- Cards can be deleted independently or cascade-deleted with their parent column (`deleted_with_column` flag)
- Score system for cards (Twitter-style favorites)

## Workflows

### Documentation Policy
The `docs/` folder is a **snapshot of the current spec and development process — it does not retain past history (経緯)**. When something changes, edit the docs in place so each one reads as the current truth. Do not accumulate historical context: no "previously X, now Y" notes, no rejected-alternative narratives, no change logs, and no records of what was edited in other docs. Git history is where the past lives.

### Before Implementing Features
Read the `docs/` folder first to understand the specification:
- `docs/000-spec.md` - Core concepts, terminology, UI/UX design
- `docs/001-keybindings.md` - Keybinding specification and focus model
- `docs/002-data-structure.md` - Data models and deletion rules
- `docs/003-roadmap.md` - Development phases
- `docs/004-e2e-testing.md` - E2E testing and WASM SQLite setup
- `docs/005-release.md` - Release strategy (Production / Preview channels, Tauri updater)
- `docs/006-tutorial.md` - Interactive onboarding tutorial (spotlight/coachmark overlay, hands-on steps)
- `docs/007-reporter-protocol.md` - Reporter protocol (local-first streaming input adapters that append cards via stdio/JSON-RPC)
- `docs/008-mcp-server.md` - Jot Deck as an MCP server (exposing Deck write/read to general agents like Claude via a stdio bridge)

### Before Creating a PR
1. Run type checks: `pnpm --filter app check`
2. Run tests: `pnpm --filter app test:run`
3. Run Rust checks: `cargo check --workspace`
4. Run Rust tests: `cargo test -p jot-deck-core -p jot-deck-mcp -p jot-deck-reporter-host`
5. All user-facing text must be in English (power-user target audience)

### Bumping the Base Version (Preview Pipeline)
The Preview release workflow derives its pre-release number from `git rev-list --count` since `packages/app/preview-base-version.txt` was last modified. This number is used as a **numeric-only** pre-release identifier (e.g. `0.1.0-42`) — the Windows MSI/WiX bundler rejects non-numeric pre-release identifiers (so no `-preview.N`) and requires the number to be ≤ 65535. Whenever you bump MAJOR / MINOR / PATCH of the app:

1. Run `node scripts/sync-version.mjs <new-version>` — this updates `package.json` files, `tauri.conf.json`, `Cargo.toml`, **and** `packages/app/preview-base-version.txt` (the bare `MAJOR.MINOR.PATCH` portion).
2. Commit the change. The next Preview build will start counting from `<new-version>-0` again (more precisely: `<new-version>-<commits-since-this-commit>`).

Never edit `packages/app/preview-base-version.txt` by hand without also updating the other version targets — keep them in sync via the script.