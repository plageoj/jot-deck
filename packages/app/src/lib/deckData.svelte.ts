import { TAG_PATTERN, type Deck, type Column, type Card, type Tag } from "$lib/types";
import { createDeleteStack } from "$lib/deleteStack";
import { getDatabase, type DatabaseBackend } from "$lib/db";

const LAST_DECK_KEY = "jot-deck:last-deck-id";

export class DeckData {
  private db!: DatabaseBackend;
  private deleteStack!: ReturnType<typeof createDeleteStack>;

  decks = $state<Deck[]>([]);
  currentDeck = $state<Deck | null>(null);
  columns = $state<Column[]>([]);
  cardsByColumn = $state<Record<string, Card[]>>({});
  loading = $state(true);
  error = $state<string | null>(null);
  deckTags = $state<Tag[]>([]);
  activeTagFilter = $state<string | null>(null);
  filteredCardIds = $state<Set<string> | null>(null);

  async init() {
    this.db = await getDatabase();
    this.deleteStack = createDeleteStack({
      onRestore: async (item) => {
        if (item.type === "card") {
          await this.db.restoreCard(item.id);
        } else {
          await this.db.restoreColumn(item.id);
        }
      },
      onError: (msg) => {
        console.error("deleteStack error:", msg);
        this.error = msg;
      },
    });
    await this.loadDecks();
  }

  async loadDecks() {
    try {
      this.loading = true;
      this.error = null;
      this.decks = await this.db.getAllDecks();
      if (this.decks.length === 0) {
        await this.createOnboardingDeck();
      }
      if (this.decks.length > 0) {
        const lastDeckId = this.getLastDeckId();
        const lastDeck = lastDeckId
          ? this.decks.find((d) => d.id === lastDeckId)
          : null;
        await this.selectDeck(lastDeck ?? this.decks[0]);
      }
    } catch (e) {
      this.error = `Failed to load decks: ${e}`;
    } finally {
      this.loading = false;
    }
  }

  private async createOnboardingDeck() {
    const deck = await this.db.createDeck({ name: "Getting Started" });
    this.decks = [deck];

    const col1 = await this.db.createColumn({
      deck_id: deck.id,
      name: "Welcome",
    });
    const col2 = await this.db.createColumn({
      deck_id: deck.id,
      name: "Navigation",
    });
    const col3 = await this.db.createColumn({
      deck_id: deck.id,
      name: "Tips",
    });

    await this.db.createCard({
      column_id: col1.id,
      content:
        "Welcome to Jot Deck!\n\nA keyboard-centric note-taking app with a TweetDeck-style column layout.\n\nPress ? to see all keybindings.",
    });
    await this.db.createCard({
      column_id: col1.id,
      content:
        "Each deck holds multiple columns, and each column holds cards.\n\nYou're looking at the \"Getting Started\" deck right now.",
    });

    await this.db.createCard({
      column_id: col2.id,
      content:
        "h / l — Move between columns\nj / k — Move between cards\ni or Enter — Edit a card\nEsc — Exit edit mode",
    });
    await this.db.createCard({
      column_id: col2.id,
      content:
        "o — New card below\nO — New card above\nc — New column\ndd — Delete card/column",
    });
    await this.db.createCard({
      column_id: col2.id,
      content:
        "Ctrl+P — Switch deck\nCtrl+Shift+P — Command palette\ng n — Switch column\n/ — Filter by tag",
    });

    await this.db.createCard({
      column_id: col3.id,
      content:
        "Use #tags in your cards to organize and filter notes.\n\nTry typing #example in a card!",
    });
    await this.db.createCard({
      column_id: col3.id,
      content:
        "Cards support Vim-style keybindings in edit mode.\n\nPress Esc to exit edit mode, then navigate with h/j/k/l.",
    });
    await this.db.createCard({
      column_id: col3.id,
      content:
        "f / + — Increase card score\nF / - — Decrease card score\n\nUse scores to highlight important cards.",
    });
  }

  private getLastDeckId(): string | null {
    try {
      return localStorage.getItem(LAST_DECK_KEY);
    } catch {
      return null;
    }
  }

  private saveLastDeckId(id: string) {
    try {
      localStorage.setItem(LAST_DECK_KEY, id);
    } catch {
      // localStorage unavailable — ignore
    }
  }

  async selectDeck(deck: Deck) {
    this.currentDeck = deck;
    this.saveLastDeckId(deck.id);
    this.clearTagFilter();
    try {
      this.columns = await this.db.getColumnsByDeck(deck.id);
      await this.loadCardsForColumns();
      await this.loadDeckTags();
    } catch (e) {
      this.error = `Failed to load columns: ${e}`;
    }
  }

  async loadCardsForColumns() {
    const entries = await Promise.all(
      this.columns.map(async (col) => {
        try {
          return [col.id, await this.db.getCardsByColumn(col.id)] as const;
        } catch (e) {
          console.error(`Failed to load cards for column ${col.id}:`, e);
          return [col.id, []] as const;
        }
      }),
    );
    this.cardsByColumn = Object.fromEntries(entries);
  }

  async reloadColumns() {
    if (!this.currentDeck) return;
    try {
      this.columns = await this.db.getColumnsByDeck(this.currentDeck.id);
      await this.loadCardsForColumns();
    } catch (e) {
      this.error = `Failed to reload columns: ${e}`;
    }
  }

  async createDeck(): Promise<Deck | null> {
    try {
      const deck = await this.db.createDeck({ name: "New Deck" });
      this.decks = [deck, ...this.decks];
      await this.selectDeck(deck);
      return deck;
    } catch (e) {
      this.error = `Failed to create deck: ${e}`;
      return null;
    }
  }

  async renameDeck(id: string, name: string): Promise<Deck | null> {
    try {
      const updated = await this.db.updateDeck(id, name);
      this.decks = this.decks.map((d) => (d.id === id ? updated : d));
      if (this.currentDeck?.id === id) {
        this.currentDeck = updated;
      }
      return updated;
    } catch (e) {
      this.error = `Failed to rename deck: ${e}`;
      return null;
    }
  }

  async deleteDeck(id: string): Promise<boolean> {
    try {
      await this.db.deleteDeck(id);
      this.decks = this.decks.filter((d) => d.id !== id);
      if (this.currentDeck?.id === id) {
        if (this.decks.length > 0) {
          await this.selectDeck(this.decks[0]);
        } else {
          this.currentDeck = null;
          this.columns = [];
          this.cardsByColumn = {};
          this.deckTags = [];
        }
      }
      return true;
    } catch (e) {
      this.error = `Failed to delete deck: ${e}`;
      return false;
    }
  }

  async createColumn(): Promise<Column | null> {
    if (!this.currentDeck) return null;
    try {
      const col = await this.db.createColumn({ deck_id: this.currentDeck.id });
      this.columns = [...this.columns, col];
      this.cardsByColumn[col.id] = [];
      return col;
    } catch (e) {
      this.error = `Failed to create column: ${e}`;
      return null;
    }
  }

  async createColumnAtPosition(position: number): Promise<Column | null> {
    if (!this.currentDeck) return null;
    try {
      const col = await this.db.createColumn({
        deck_id: this.currentDeck.id,
        position,
      });
      await this.reloadColumns();
      return col;
    } catch (e) {
      this.error = `Failed to create column: ${e}`;
      return null;
    }
  }

  async createCard(
    columnId: string,
    content = "",
    position?: number,
  ): Promise<Card | null> {
    try {
      const card = await this.db.createCard({
        column_id: columnId,
        content,
        position,
      });
      if (position !== undefined) {
        await this.loadCardsForColumns();
      } else {
        this.cardsByColumn[columnId] = [
          ...(this.cardsByColumn[columnId] || []),
          card,
        ];
      }
      return card;
    } catch (e) {
      this.error = `Failed to create card: ${e}`;
      return null;
    }
  }

  async saveCard(cardId: string, content: string) {
    try {
      const updatedCard = await this.db.updateCardContent(cardId, content);
      for (const columnId of Object.keys(this.cardsByColumn)) {
        const cards = this.cardsByColumn[columnId];
        const index = cards.findIndex((c) => c.id === cardId);
        if (index !== -1) {
          this.cardsByColumn[columnId] = [
            ...cards.slice(0, index),
            updatedCard,
            ...cards.slice(index + 1),
          ];
          break;
        }
      }
      await this.loadDeckTags();
    } catch (e) {
      this.error = `Failed to save card: ${e}`;
    }
  }

  async deleteColumn(columnId: string): Promise<boolean> {
    try {
      await this.db.deleteColumn(columnId);
      this.deleteStack.push({ type: "column", id: columnId });
      await this.reloadColumns();
      return true;
    } catch (e) {
      this.error = `Failed to delete column: ${e}`;
      return false;
    }
  }

  async deleteCard(cardId: string): Promise<boolean> {
    try {
      await this.db.deleteCard(cardId);
      this.deleteStack.push({ type: "card", id: cardId });
      await this.loadCardsForColumns();
      return true;
    } catch (e) {
      this.error = `Failed to delete card: ${e}`;
      return false;
    }
  }

  async moveColumn(id: string, position: number): Promise<boolean> {
    try {
      await this.db.moveColumn(id, position);
      await this.reloadColumns();
      return true;
    } catch (e) {
      this.error = `Failed to move column: ${e}`;
      return false;
    }
  }

  async moveCard(id: string, position: number): Promise<boolean> {
    try {
      await this.db.moveCard(id, position);
      await this.loadCardsForColumns();
      return true;
    } catch (e) {
      this.error = `Failed to move card: ${e}`;
      return false;
    }
  }

  async moveCardToColumn(cardId: string, columnId: string): Promise<boolean> {
    try {
      await this.db.moveCardToColumn(cardId, columnId);
      await this.loadCardsForColumns();
      return true;
    } catch (e) {
      this.error = `Failed to move card: ${e}`;
      return false;
    }
  }

  async updateCardScore(cardId: string, delta: number) {
    try {
      await this.db.updateCardScore(cardId, delta);
      await this.loadCardsForColumns();
    } catch (e) {
      this.error = `Failed to update score: ${e}`;
    }
  }

  async loadDeckTags() {
    if (!this.currentDeck) return;
    try {
      this.deckTags = await this.db.getTagsByDeck(this.currentDeck.id);
    } catch (e) {
      console.error("Failed to load deck tags:", e);
    }
  }

  filterByTag(tagName: string) {
    this.activeTagFilter = tagName;
    const re = new RegExp(TAG_PATTERN, "g");
    const matchingIds: string[] = [];
    for (const cards of Object.values(this.cardsByColumn)) {
      for (const card of cards) {
        let match;
        re.lastIndex = 0;
        while ((match = re.exec(card.content)) !== null) {
          if (match[1] === tagName) {
            matchingIds.push(card.id);
            break;
          }
        }
      }
    }
    this.filteredCardIds = new Set(matchingIds);
  }

  clearTagFilter() {
    this.activeTagFilter = null;
    this.filteredCardIds = null;
  }

  async getTagSuggestions(prefix: string): Promise<Tag[]> {
    if (!this.currentDeck) return [];
    try {
      return await this.db.getTagSuggestions(this.currentDeck.id, prefix);
    } catch (e) {
      console.error("Failed to get tag suggestions:", e);
      return [];
    }
  }

  async undoLastDelete(): Promise<boolean> {
    const success = await this.deleteStack.popAndRestore();
    if (success) {
      await this.reloadColumns();
    }
    return success;
  }
}
