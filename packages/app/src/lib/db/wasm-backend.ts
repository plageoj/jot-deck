/**
 * WASM SQLite Backend Implementation
 *
 * Uses sql.js for in-browser SQLite support.
 * This enables e2e testing and future web version.
 */

import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { ulid } from "ulid";
import type { Deck, Column, Card } from "../types";
import type {
  DatabaseBackend,
  CreateDeckParams,
  CreateColumnParams,
  CreateCardParams,
} from "./types";

// SQL.js WASM binary URL - loaded from CDN
const SQL_WASM_URL = "https://sql.js.org/dist/sql-wasm.wasm";

// Type for a row of values from sql.js
type SqlRow = SqlValue[];

/**
 * WASM SQLite Backend
 *
 * Implements the same database operations as the Rust backend,
 * using sql.js for in-browser SQLite.
 */
export class WasmBackend implements DatabaseBackend {
  private db: Database | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the database
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: () => SQL_WASM_URL,
    });

    this.db = new SQL.Database();
    this.createSchema();
  }

  private createSchema(): void {
    if (!this.db) throw new Error("Database not initialized");

    // Enable foreign keys
    this.db.run("PRAGMA foreign_keys = ON");

    // Create tables matching the Rust schema
    this.db.run(`
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order TEXT NOT NULL DEFAULT 'created_desc',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        deck_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (deck_id) REFERENCES decks(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        column_id TEXT NOT NULL,
        content TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_with_column INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (column_id) REFERENCES columns(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS card_tags (
        card_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (card_id, tag_id),
        FOREIGN KEY (card_id) REFERENCES cards(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id)
      )
    `);

    // Create indexes
    this.db.run("CREATE INDEX IF NOT EXISTS idx_columns_deck_id ON columns(deck_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_columns_deleted_at ON columns(deleted_at)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_cards_column_id ON cards(column_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_cards_deleted_at ON cards(deleted_at)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_card_tags_tag_id ON card_tags(tag_id)");
  }

  private ensureDb(): Database {
    if (!this.db) throw new Error("Database not initialized. Call init() first.");
    return this.db;
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ========================================
  // Deck Operations
  // ========================================

  async getAllDecks(): Promise<Deck[]> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      "SELECT id, name, sort_order, created_at, updated_at FROM decks ORDER BY created_at DESC"
    );
    if (results.length === 0) return [];
    return results[0].values.map((row: SqlRow) => this.rowToDeck(row));
  }

  async getDeck(id: string): Promise<Deck> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      "SELECT id, name, sort_order, created_at, updated_at FROM decks WHERE id = ?",
      [id]
    );
    if (results.length === 0 || results[0].values.length === 0) {
      throw new Error(`Deck not found: ${id}`);
    }
    return this.rowToDeck(results[0].values[0]);
  }

  async createDeck(params: CreateDeckParams): Promise<Deck> {
    await this.init();
    const db = this.ensureDb();
    const id = ulid();
    const now = this.now();
    const sortOrder = params.sort_order || "created_desc";

    db.run(
      "INSERT INTO decks (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [id, params.name, sortOrder, now, now]
    );

    return this.getDeck(id);
  }

  async updateDeck(
    id: string,
    name?: string,
    sortOrder?: string
  ): Promise<Deck> {
    await this.init();
    const db = this.ensureDb();
    const deck = await this.getDeck(id);
    const now = this.now();

    db.run(
      "UPDATE decks SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?",
      [name ?? deck.name, sortOrder ?? deck.sort_order, now, id]
    );

    return this.getDeck(id);
  }

  async deleteDeck(id: string): Promise<void> {
    await this.init();
    const db = this.ensureDb();

    // Delete in order: card_tags, cards, columns, deck
    db.run(
      `DELETE FROM card_tags WHERE card_id IN (
        SELECT c.id FROM cards c
        JOIN columns col ON c.column_id = col.id
        WHERE col.deck_id = ?
      )`,
      [id]
    );
    db.run(
      `DELETE FROM cards WHERE column_id IN (
        SELECT id FROM columns WHERE deck_id = ?
      )`,
      [id]
    );
    db.run("DELETE FROM columns WHERE deck_id = ?", [id]);
    db.run("DELETE FROM decks WHERE id = ?", [id]);
  }

  // ========================================
  // Column Operations
  // ========================================

  async getColumnsByDeck(deckId: string): Promise<Column[]> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      `SELECT id, deck_id, name, position, created_at, updated_at, deleted_at
       FROM columns
       WHERE deck_id = ? AND deleted_at IS NULL
       ORDER BY position ASC`,
      [deckId]
    );
    if (results.length === 0) return [];
    return results[0].values.map((row: SqlRow) => this.rowToColumn(row));
  }

  async getColumn(id: string): Promise<Column> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      "SELECT id, deck_id, name, position, created_at, updated_at, deleted_at FROM columns WHERE id = ?",
      [id]
    );
    if (results.length === 0 || results[0].values.length === 0) {
      throw new Error(`Column not found: ${id}`);
    }
    return this.rowToColumn(results[0].values[0]);
  }

  async createColumn(params: CreateColumnParams): Promise<Column> {
    await this.init();
    const db = this.ensureDb();
    const id = ulid();
    const now = this.now();

    // Get column count for auto-naming
    const countResult = db.exec(
      "SELECT COUNT(*) FROM columns WHERE deck_id = ? AND deleted_at IS NULL",
      [params.deck_id]
    );
    const count = (countResult[0]?.values[0]?.[0] as number) ?? 0;
    const name = params.name || `Column ${count + 1}`;

    // Get max position or use provided position
    let position: number;
    if (params.position !== undefined) {
      position = params.position;
      // Shift existing columns
      db.run(
        `UPDATE columns SET position = position + 1, updated_at = ?
         WHERE deck_id = ? AND position >= ? AND deleted_at IS NULL`,
        [now, params.deck_id, position]
      );
    } else {
      const maxResult = db.exec(
        "SELECT COALESCE(MAX(position), -1) FROM columns WHERE deck_id = ? AND deleted_at IS NULL",
        [params.deck_id]
      );
      position = ((maxResult[0]?.values[0]?.[0] as number) ?? -1) + 1;
    }

    db.run(
      `INSERT INTO columns (id, deck_id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, params.deck_id, name, position, now, now]
    );

    return this.getColumn(id);
  }

  async updateColumn(id: string, name: string): Promise<Column> {
    await this.init();
    const db = this.ensureDb();
    const now = this.now();

    db.run("UPDATE columns SET name = ?, updated_at = ? WHERE id = ?", [
      name,
      now,
      id,
    ]);

    return this.getColumn(id);
  }

  async moveColumn(id: string, position: number): Promise<Column> {
    await this.init();
    const db = this.ensureDb();
    const column = await this.getColumn(id);
    const now = this.now();
    const oldPosition = column.position;

    if (position === oldPosition) return column;

    if (position < oldPosition) {
      // Moving left: shift items in [position, oldPosition) right
      db.run(
        `UPDATE columns SET position = position + 1, updated_at = ?
         WHERE deck_id = ? AND position >= ? AND position < ? AND deleted_at IS NULL`,
        [now, column.deck_id, position, oldPosition]
      );
    } else {
      // Moving right: shift items in (oldPosition, position] left
      db.run(
        `UPDATE columns SET position = position - 1, updated_at = ?
         WHERE deck_id = ? AND position > ? AND position <= ? AND deleted_at IS NULL`,
        [now, column.deck_id, oldPosition, position]
      );
    }

    db.run("UPDATE columns SET position = ?, updated_at = ? WHERE id = ?", [
      position,
      now,
      id,
    ]);

    return this.getColumn(id);
  }

  async deleteColumn(id: string): Promise<void> {
    await this.init();
    const db = this.ensureDb();
    const column = await this.getColumn(id);
    const now = this.now();

    // Soft delete the column
    db.run("UPDATE columns SET deleted_at = ?, updated_at = ? WHERE id = ?", [
      now,
      now,
      id,
    ]);

    // Soft delete all cards in the column, marking them as deleted_with_column
    db.run(
      `UPDATE cards SET deleted_at = ?, deleted_with_column = 1, updated_at = ?
       WHERE column_id = ? AND deleted_at IS NULL`,
      [now, now, id]
    );

    // Compact positions
    db.run(
      `UPDATE columns SET position = position - 1, updated_at = ?
       WHERE deck_id = ? AND position > ? AND deleted_at IS NULL`,
      [now, column.deck_id, column.position]
    );
  }

  async restoreColumn(id: string): Promise<Column> {
    await this.init();
    const db = this.ensureDb();
    const column = await this.getColumn(id);
    const now = this.now();

    // Get max position
    const maxResult = db.exec(
      "SELECT COALESCE(MAX(position), -1) FROM columns WHERE deck_id = ? AND deleted_at IS NULL",
      [column.deck_id]
    );
    const newPosition = ((maxResult[0]?.values[0]?.[0] as number) ?? -1) + 1;

    // Restore column
    db.run(
      "UPDATE columns SET deleted_at = NULL, position = ?, updated_at = ? WHERE id = ?",
      [newPosition, now, id]
    );

    // Restore cards that were deleted with the column
    db.run(
      `UPDATE cards SET deleted_at = NULL, deleted_with_column = 0, updated_at = ?
       WHERE column_id = ? AND deleted_with_column = 1`,
      [now, id]
    );

    return this.getColumn(id);
  }

  async getDeletedColumns(deckId: string): Promise<Column[]> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      `SELECT id, deck_id, name, position, created_at, updated_at, deleted_at
       FROM columns
       WHERE deck_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [deckId]
    );
    if (results.length === 0) return [];
    return results[0].values.map((row: SqlRow) => this.rowToColumn(row));
  }

  // ========================================
  // Card Operations
  // ========================================

  async getCardsByColumn(columnId: string): Promise<Card[]> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      `SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column
       FROM cards
       WHERE column_id = ? AND deleted_at IS NULL
       ORDER BY position ASC`,
      [columnId]
    );
    if (results.length === 0) return [];
    return results[0].values.map((row: SqlRow) => this.rowToCard(row));
  }

  async getCard(id: string): Promise<Card> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      `SELECT id, column_id, content, score, position, created_at, updated_at, deleted_at, deleted_with_column
       FROM cards WHERE id = ?`,
      [id]
    );
    if (results.length === 0 || results[0].values.length === 0) {
      throw new Error(`Card not found: ${id}`);
    }
    return this.rowToCard(results[0].values[0]);
  }

  async createCard(params: CreateCardParams): Promise<Card> {
    await this.init();
    const db = this.ensureDb();
    const id = ulid();
    const now = this.now();

    // Get max position or use provided position
    let position: number;
    if (params.position !== undefined) {
      position = params.position;
      // Shift existing cards
      db.run(
        `UPDATE cards SET position = position + 1, updated_at = ?
         WHERE column_id = ? AND position >= ? AND deleted_at IS NULL`,
        [now, params.column_id, position]
      );
    } else {
      const maxResult = db.exec(
        "SELECT COALESCE(MAX(position), -1) FROM cards WHERE column_id = ? AND deleted_at IS NULL",
        [params.column_id]
      );
      position = ((maxResult[0]?.values[0]?.[0] as number) ?? -1) + 1;
    }

    db.run(
      `INSERT INTO cards (id, column_id, content, score, position, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [id, params.column_id, params.content, position, now, now]
    );

    // Sync tags
    await this.syncCardTags(id, params.content);

    return this.getCard(id);
  }

  async updateCardContent(id: string, content: string): Promise<Card> {
    await this.init();
    const db = this.ensureDb();
    const now = this.now();

    db.run("UPDATE cards SET content = ?, updated_at = ? WHERE id = ?", [
      content,
      now,
      id,
    ]);

    // Sync tags
    await this.syncCardTags(id, content);

    return this.getCard(id);
  }

  async updateCardScore(id: string, delta: number): Promise<Card> {
    await this.init();
    const db = this.ensureDb();
    const now = this.now();

    db.run(
      "UPDATE cards SET score = score + ?, updated_at = ? WHERE id = ?",
      [delta, now, id]
    );

    return this.getCard(id);
  }

  async moveCardToColumn(id: string, columnId: string): Promise<Card> {
    await this.init();
    const db = this.ensureDb();
    const card = await this.getCard(id);
    const now = this.now();

    // Compact positions in old column
    db.run(
      `UPDATE cards SET position = position - 1, updated_at = ?
       WHERE column_id = ? AND position > ? AND deleted_at IS NULL`,
      [now, card.column_id, card.position]
    );

    // Get max position in new column
    const maxResult = db.exec(
      "SELECT COALESCE(MAX(position), -1) FROM cards WHERE column_id = ? AND deleted_at IS NULL",
      [columnId]
    );
    const newPosition = ((maxResult[0]?.values[0]?.[0] as number) ?? -1) + 1;

    // Move card
    db.run(
      "UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?",
      [columnId, newPosition, now, id]
    );

    return this.getCard(id);
  }

  async moveCard(id: string, position: number): Promise<Card> {
    await this.init();
    const db = this.ensureDb();
    const card = await this.getCard(id);
    const now = this.now();
    const oldPosition = card.position;

    if (position === oldPosition) return card;

    if (position < oldPosition) {
      // Moving up: shift items in [position, oldPosition) down
      db.run(
        `UPDATE cards SET position = position + 1, updated_at = ?
         WHERE column_id = ? AND position >= ? AND position < ? AND deleted_at IS NULL`,
        [now, card.column_id, position, oldPosition]
      );
    } else {
      // Moving down: shift items in (oldPosition, position] up
      db.run(
        `UPDATE cards SET position = position - 1, updated_at = ?
         WHERE column_id = ? AND position > ? AND position <= ? AND deleted_at IS NULL`,
        [now, card.column_id, oldPosition, position]
      );
    }

    db.run("UPDATE cards SET position = ?, updated_at = ? WHERE id = ?", [
      position,
      now,
      id,
    ]);

    return this.getCard(id);
  }

  async deleteCard(id: string): Promise<void> {
    await this.init();
    const db = this.ensureDb();
    const card = await this.getCard(id);
    const now = this.now();

    // Soft delete the card
    db.run("UPDATE cards SET deleted_at = ?, updated_at = ? WHERE id = ?", [
      now,
      now,
      id,
    ]);

    // Compact positions
    db.run(
      `UPDATE cards SET position = position - 1, updated_at = ?
       WHERE column_id = ? AND position > ? AND deleted_at IS NULL`,
      [now, card.column_id, card.position]
    );
  }

  async restoreCard(id: string): Promise<Card> {
    await this.init();
    const db = this.ensureDb();
    const card = await this.getCard(id);
    const now = this.now();

    // Get max position in the column
    const maxResult = db.exec(
      "SELECT COALESCE(MAX(position), -1) FROM cards WHERE column_id = ? AND deleted_at IS NULL",
      [card.column_id]
    );
    const newPosition = ((maxResult[0]?.values[0]?.[0] as number) ?? -1) + 1;

    // Restore card
    db.run(
      "UPDATE cards SET deleted_at = NULL, deleted_with_column = 0, position = ?, updated_at = ? WHERE id = ?",
      [newPosition, now, id]
    );

    return this.getCard(id);
  }

  async getDeletedCards(deckId: string): Promise<Card[]> {
    await this.init();
    const db = this.ensureDb();
    const results = db.exec(
      `SELECT c.id, c.column_id, c.content, c.score, c.position,
              c.created_at, c.updated_at, c.deleted_at, c.deleted_with_column
       FROM cards c
       JOIN columns col ON c.column_id = col.id
       WHERE col.deck_id = ? AND c.deleted_at IS NOT NULL
       ORDER BY c.deleted_at DESC`,
      [deckId]
    );
    if (results.length === 0) return [];
    return results[0].values.map((row: SqlRow) => this.rowToCard(row));
  }

  // ========================================
  // Tag Operations (internal)
  // ========================================

  private extractTags(content: string): string[] {
    const matches = content.match(/#(\w+)/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
  }

  private async syncCardTags(cardId: string, content: string): Promise<void> {
    const db = this.ensureDb();
    const tags = this.extractTags(content);

    // Clear existing tags
    db.run("DELETE FROM card_tags WHERE card_id = ?", [cardId]);

    // Add new tags
    for (const tagName of tags) {
      // Get or create tag
      let tagId: string;
      const existingTag = db.exec("SELECT id FROM tags WHERE name = ?", [
        tagName,
      ]);
      if (existingTag.length > 0 && existingTag[0].values.length > 0) {
        tagId = existingTag[0].values[0][0] as string;
      } else {
        tagId = ulid();
        db.run("INSERT INTO tags (id, name) VALUES (?, ?)", [tagId, tagName]);
      }

      // Associate tag with card
      db.run("INSERT OR IGNORE INTO card_tags (card_id, tag_id) VALUES (?, ?)", [
        cardId,
        tagId,
      ]);
    }
  }

  // ========================================
  // Row Mappers
  // ========================================

  private rowToDeck(row: unknown[]): Deck {
    return {
      id: row[0] as string,
      name: row[1] as string,
      sort_order: row[2] as string,
      created_at: row[3] as string,
      updated_at: row[4] as string,
    };
  }

  private rowToColumn(row: unknown[]): Column {
    return {
      id: row[0] as string,
      deck_id: row[1] as string,
      name: row[2] as string,
      position: row[3] as number,
      created_at: row[4] as string,
      updated_at: row[5] as string,
      deleted_at: row[6] as string | null,
    };
  }

  private rowToCard(row: unknown[]): Card {
    return {
      id: row[0] as string,
      column_id: row[1] as string,
      content: row[2] as string,
      score: row[3] as number,
      position: row[4] as number,
      created_at: row[5] as string,
      updated_at: row[6] as string,
      deleted_at: row[7] as string | null,
      deleted_with_column: (row[8] as number) === 1,
    };
  }
}
