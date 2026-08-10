/**
 * Database abstraction types
 *
 * These interfaces define the contract for database operations,
 * allowing different implementations (Tauri/Rust or WASM SQLite).
 */

import type { Deck, Column, Card, Tag, ReporterConfig } from "../types";

export interface CreateDeckParams {
  name: string;
  sort_order?: string;
}

export interface CreateColumnParams {
  deck_id: string;
  name?: string;
  position?: number;
}

export interface CreateCardParams {
  column_id: string;
  content: string;
  position?: number;
}

/**
 * Database backend interface
 *
 * All methods mirror the Tauri commands defined in lib.rs
 */
export interface DatabaseBackend {
  // Deck operations
  getAllDecks(): Promise<Deck[]>;
  getDeck(id: string): Promise<Deck>;
  createDeck(params: CreateDeckParams): Promise<Deck>;
  updateDeck(
    id: string,
    name?: string,
    sortOrder?: string
  ): Promise<Deck>;
  deleteDeck(id: string): Promise<void>;

  // Column operations
  getColumnsByDeck(deckId: string): Promise<Column[]>;
  getColumn(id: string): Promise<Column>;
  createColumn(params: CreateColumnParams): Promise<Column>;
  updateColumn(
    id: string,
    name?: string,
    description?: string,
    isPrivate?: boolean
  ): Promise<Column>;
  moveColumn(id: string, position: number): Promise<Column>;
  deleteColumn(id: string): Promise<void>;
  restoreColumn(id: string): Promise<Column>;
  getDeletedColumns(deckId: string): Promise<Column[]>;

  // Card operations
  getCardsByColumn(columnId: string): Promise<Card[]>;
  getCard(id: string): Promise<Card>;
  createCard(params: CreateCardParams): Promise<Card>;
  updateCardContent(id: string, content: string): Promise<Card>;
  updateCardScore(id: string, delta: number): Promise<Card>;
  moveCardToColumn(id: string, columnId: string): Promise<Card>;
  moveCard(id: string, position: number): Promise<Card>;
  deleteCard(id: string): Promise<void>;
  restoreCard(id: string): Promise<Card>;
  getDeletedCards(deckId: string): Promise<Card[]>;

  // Tag operations
  getTagsByDeck(deckId: string): Promise<Tag[]>;
  getCardsByTag(deckId: string, tagName: string): Promise<string[]>;
  getTagSuggestions(deckId: string, prefix: string): Promise<Tag[]>;

  // Settings operations (key/value JSON store; null when unset)
  getSettings(key: string): Promise<string | null>;
  setSettings(key: string, value: string): Promise<void>;

  // MCP operations
  /** Generate a paste-ready `mcpServers` config snippet for the given deck.
   * Returns null when unavailable (e.g. the browser/WASM backend, which has no
   * bundled bridge binary or real filesystem paths). */
  generateMcpConfig(deckId: string): Promise<string | null>;

  // Reporter host operations (007-reporter-protocol.md). Desktop-only: the
  // browser/WASM backend cannot spawn child processes, so reads return empty
  // and writes reject.
  /** List a deck's registered Reporters. */
  listReporters(deckId: string): Promise<ReporterConfig[]>;
  /** Register a new Reporter; the host assigns and returns its `reporter_id`. */
  addReporter(deckId: string, config: ReporterConfig): Promise<ReporterConfig>;
  /** Update an existing Reporter registration in place (matched by id). */
  updateReporter(
    deckId: string,
    config: ReporterConfig
  ): Promise<ReporterConfig>;
  /** Remove a Reporter registration (stopping it first if running). */
  removeReporter(deckId: string, reporterId: string): Promise<void>;
  /** Spawn a registered Reporter and start pumping its stdio. */
  startReporter(deckId: string, reporterId: string): Promise<void>;
  /** Stop a running Reporter. */
  stopReporter(reporterId: string): Promise<void>;
  /** Ids of Reporters currently running (spans all decks). */
  listRunningReporters(): Promise<string[]>;
}
