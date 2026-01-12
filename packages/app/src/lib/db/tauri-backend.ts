/**
 * Tauri Backend Implementation
 *
 * Uses Tauri's invoke API to communicate with the Rust backend.
 * This is the production backend for the desktop app.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Deck, Column, Card } from "../types";
import type {
  DatabaseBackend,
  CreateDeckParams,
  CreateColumnParams,
  CreateCardParams,
} from "./types";

export class TauriBackend implements DatabaseBackend {
  // Deck operations
  async getAllDecks(): Promise<Deck[]> {
    return invoke<Deck[]>("get_all_decks");
  }

  async getDeck(id: string): Promise<Deck> {
    return invoke<Deck>("get_deck", { id });
  }

  async createDeck(params: CreateDeckParams): Promise<Deck> {
    return invoke<Deck>("create_deck", { params });
  }

  async updateDeck(
    id: string,
    name?: string,
    sortOrder?: string
  ): Promise<Deck> {
    return invoke<Deck>("update_deck", { id, name, sortOrder });
  }

  async deleteDeck(id: string): Promise<void> {
    return invoke("delete_deck", { id });
  }

  // Column operations
  async getColumnsByDeck(deckId: string): Promise<Column[]> {
    return invoke<Column[]>("get_columns_by_deck", { deckId });
  }

  async getColumn(id: string): Promise<Column> {
    return invoke<Column>("get_column", { id });
  }

  async createColumn(params: CreateColumnParams): Promise<Column> {
    return invoke<Column>("create_column", { params });
  }

  async updateColumn(id: string, name: string): Promise<Column> {
    return invoke<Column>("update_column", { id, name });
  }

  async moveColumn(id: string, position: number): Promise<Column> {
    return invoke<Column>("move_column", { id, position });
  }

  async deleteColumn(id: string): Promise<void> {
    return invoke("delete_column", { id });
  }

  async restoreColumn(id: string): Promise<Column> {
    return invoke<Column>("restore_column", { id });
  }

  async getDeletedColumns(deckId: string): Promise<Column[]> {
    return invoke<Column[]>("get_deleted_columns", { deckId });
  }

  // Card operations
  async getCardsByColumn(columnId: string): Promise<Card[]> {
    return invoke<Card[]>("get_cards_by_column", { columnId });
  }

  async getCard(id: string): Promise<Card> {
    return invoke<Card>("get_card", { id });
  }

  async createCard(params: CreateCardParams): Promise<Card> {
    return invoke<Card>("create_card", { params });
  }

  async updateCardContent(id: string, content: string): Promise<Card> {
    return invoke<Card>("update_card_content", { id, content });
  }

  async updateCardScore(id: string, delta: number): Promise<Card> {
    return invoke<Card>("update_card_score", { id, delta });
  }

  async moveCardToColumn(id: string, columnId: string): Promise<Card> {
    return invoke<Card>("move_card_to_column", { id, columnId });
  }

  async moveCard(id: string, position: number): Promise<Card> {
    return invoke<Card>("move_card", { id, position });
  }

  async deleteCard(id: string): Promise<void> {
    return invoke("delete_card", { id });
  }

  async restoreCard(id: string): Promise<Card> {
    return invoke<Card>("restore_card", { id });
  }

  async getDeletedCards(deckId: string): Promise<Card[]> {
    return invoke<Card[]>("get_deleted_cards", { deckId });
  }
}
