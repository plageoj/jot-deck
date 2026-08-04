export interface Deck {
  id: string;
  name: string;
  sort_order: string;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  deck_id: string;
  name: string;
  position: number;
  /** 1-line description of what goes in this column (classification axis).
   * Improves external agent routing accuracy (008-mcp-server.md §4.6). */
  description: string | null;
  /** When true, this column is excluded from all external write/MCP access
   * (008-mcp-server.md §4.5). */
  private: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Tag regex pattern source (without flags). Keep in sync with crates/core/repository/tag.rs */
export const TAG_PATTERN = String.raw`#([\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]+)`;

export interface Tag {
  id: string;
  name: string;
}

export interface Card {
  id: string;
  column_id: string;
  content: string;
  score: number;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_with_column: boolean;
  /** Editor currently occupying this card (002 §5.2): null = free,
   * "user" = hand edit, or a writer id (e.g. an AI connection). */
  locked_by: string | null;
  /** When the occupancy lock was taken; it expires after a lease (002 §5.2). */
  locked_at: string | null;
}

/** A registered Reporter (007-reporter-protocol.md §2.2): an external input
 * adapter the host spawns as a child process and pipes over stdio. Field names
 * are snake_case because this object is serialized straight into the Rust
 * `ReporterConfig` struct via Tauri. The auth-scope fields (`deny`,
 * `max_writes_per_min`, `allowed_columns`, 007 §10) are carried but not yet
 * editable in the UI — they are sent as defaults. */
export interface ReporterConfig {
  /** Stable ULID assigned by the host on add; empty when creating a new one. */
  reporter_id: string;
  /** Human-readable label shown in the registration UI. */
  name: string;
  /** Absolute path to the Reporter binary. */
  command: string;
  /** Command-line arguments passed to the binary. */
  args: string[];
  /** Extra environment variables for the child process. */
  env: Record<string, string>;
  /** Capabilities to disable (`append`/`edit`/`delete`/`structure`). */
  deny: string[];
  /** Per-Reporter write rate cap; null uses the host default. */
  max_writes_per_min: number | null;
  /** Write allowlist by column ULID; null = the whole deck. */
  allowed_columns: string[] | null;
}

export type TrashItem =
  | { type: "column"; id: string; column: Column; deletedAt: string }
  | {
      type: "card";
      id: string;
      card: Card;
      columnName: string;
      deletedAt: string;
    };
