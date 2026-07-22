# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jot Deck is a keyboard-centric, local-first note-taking app with a TweetDeck-style column UI. It uses Tauri v2 (Rust backend) with a Svelte 5 + TypeScript frontend. The app is designed for power users who want to capture ideas quickly using Vim-style keybindings.

## Commands

### Development
```bash
pnpm install          # Install dependencies
pnpm dev              # Start Tauri dev server (main app)
pnpm web:dev          # Start landing page dev server
```

### Testing
```bash
pnpm --filter app test        # Run frontend tests in watch mode
pnpm --filter app test:run    # Run frontend tests once
```

### Building
```bash
pnpm build            # Build Tauri app
pnpm web:build        # Build landing page
```

### Type Checking
```bash
pnpm --filter app check       # Run svelte-check
```

### Rust (from crates/core or packages/app/src-tauri)
```bash
cargo check           # Type check Rust code
cargo test            # Run Rust tests
```

## Architecture

### Monorepo Structure
- `packages/app/` - Tauri application (SvelteKit frontend + Rust backend)
- `packages/web/` - Landing page (Astro, deployed to Cloudflare Pages)
- `crates/core/` - Rust core library (SQLite/FTS5 database, models, repositories)

### Frontend (packages/app/src)
- **Components** (`src/lib/components/`): Deck, Column, Card, CardEditor (CodeMirror 6 with Vim mode), VirtualList
- **Types** (`src/lib/types.ts`): TypeScript interfaces mirroring Rust models (Deck, Column, Card)
- **Keybindings** (`src/lib/keybindings.ts`): Vim+Twitter-style keybinding system with focus modes (column/card/edit)
- **Delete Stack** (`src/lib/deleteStack.ts`): Soft delete/restore functionality

### Backend (crates/core)
- `models.rs` - Data models: Deck, Column, Card, Tag with ULID IDs
- `db.rs` - SQLite connection setup (file-based or in-memory)
- `repository/` - CRUD operations for each entity (deck, column, card, tag)
- `cleanup.rs` - Physical deletion of soft-deleted items after 30 days

### Tauri Bridge (packages/app/src-tauri)
- Exposes `jot-deck-core` functionality to the frontend via Tauri commands
- Uses `jot-deck-core` as a dependency

### Focus Model
The app has four focus modes that determine keybinding behavior:
1. **Column focus** - Navigate/reorder columns, create cards
2. **Card focus** - Navigate/reorder/delete cards, enter edit mode
3. **Edit focus** - CodeMirror Vim mode active for text editing
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
3. Run Rust checks: `cargo check` (in crates/core and packages/app/src-tauri)
4. Run Rust tests: `cargo test` (in crates/core)
5. All user-facing text must be in English (power-user target audience)

### Bumping the Base Version (Preview Pipeline)
The Preview release workflow derives its pre-release number from `git rev-list --count` since `packages/app/preview-base-version.txt` was last modified. This number is used as a **numeric-only** pre-release identifier (e.g. `0.1.0-42`) — the Windows MSI/WiX bundler rejects non-numeric pre-release identifiers (so no `-preview.N`) and requires the number to be ≤ 65535. Whenever you bump MAJOR / MINOR / PATCH of the app:

1. Run `node scripts/sync-version.mjs <new-version>` — this updates `package.json` files, `tauri.conf.json`, `Cargo.toml`, **and** `packages/app/preview-base-version.txt` (the bare `MAJOR.MINOR.PATCH` portion).
2. Commit the change. The next Preview build will start counting from `<new-version>-0` again (more precisely: `<new-version>-<commits-since-this-commit>`).

Never edit `packages/app/preview-base-version.txt` by hand without also updating the other version targets — keep them in sync via the script.