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
The app has three focus modes that determine keybinding behavior:
1. **Column focus** - Navigate/reorder columns, create cards
2. **Card focus** - Navigate/reorder/delete cards, enter edit mode
3. **Edit focus** - CodeMirror Vim mode active for text editing

### Key Design Patterns
- Soft deletion with `deleted_at` timestamps; physical deletion after 30 days
- Position-based ordering for columns and cards
- Cards can be deleted independently or cascade-deleted with their parent column (`deleted_with_column` flag)
- Score system for cards (Twitter-style favorites)

## Workflows

### Before Implementing Features
Read the `docs/` folder first to understand the specification:
- `docs/000-spec.md` - Core concepts, terminology, UI/UX design
- `docs/001-keybindings.md` - Keybinding specification and focus model
- `docs/002-data-structure.md` - Data models and deletion rules
- `docs/003-roadmap.md` - Development phases

### Before Creating a PR
1. Run type checks: `pnpm --filter app check`
2. Run tests: `pnpm --filter app test:run`
3. Run Rust checks: `cargo check` (in crates/core and packages/app/src-tauri)
4. Run Rust tests: `cargo test` (in crates/core)
