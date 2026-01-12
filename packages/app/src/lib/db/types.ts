/**
 * Database abstraction types
 *
 * These interfaces define the contract for database operations,
 * allowing different implementations (Tauri/Rust or WASM SQLite).
 */

import type { Deck, Column, Card } from "../types";

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
  updateColumn(id: string, name: string): Promise<Column>;
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
}
