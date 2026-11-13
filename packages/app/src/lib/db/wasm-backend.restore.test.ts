import { describe, it, expect, vi } from "vitest";
import { WasmBackend } from "./wasm-backend";

// The web demo runs entirely on this backend, so deletion, restore and
// reordering must follow the same rules as the Rust core (docs/002).

// jsdom cannot fetch the Vite asset path, so hand sql.js the same bundled
// binary inline (Node's fetch supports data: URLs).
vi.mock("sql.js/dist/sql-wasm-browser.wasm?url", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const binary = readFileSync(require.resolve("sql.js/dist/sql-wasm-browser.wasm"));
  return {
    default: `data:application/wasm;base64,${binary.toString("base64")}`,
  };
});

async function board(columnNames: string[], cardsPerColumn: number) {
  const backend = new WasmBackend();
  const deck = await backend.createDeck({ name: "Restore deck" });
  const columns = [];
  for (const name of columnNames) {
    const column = await backend.createColumn({ deck_id: deck.id, name });
    const cards = [];
    for (let i = 0; i < cardsPerColumn; i++) {
      cards.push(
        await backend.createCard({ column_id: column.id, content: `${name}-${i}`, position: i }),
      );
    }
    columns.push({ column, cards });
  }
  return { backend, deck, columns };
}

async function contents(backend: WasmBackend, columnId: string) {
  return (await backend.getCardsByColumn(columnId)).map((card) => [card.content, card.position]);
}

describe("WasmBackend column delete and restore", () => {
  it("restores only the cards deleted with the column, at the end of the deck", async () => {
    const { backend, deck, columns } = await board(["A", "B", "C"], 3);
    const [, b] = columns;
    await backend.deleteCard(b.cards[0].id);
    await backend.deleteColumn(b.column.id);

    const cascaded = await backend.getCardsByColumn(b.column.id);
    expect(cascaded).toEqual([]);
    const deleted = await backend.getDeletedCards(deck.id);
    expect(
      deleted.map((card) => [card.content, card.deleted_with_column]).sort(),
    ).toEqual([
      ["B-0", false],
      ["B-1", true],
      ["B-2", true],
    ]);
    // A column delete keeps the live columns gap-free.
    expect((await backend.getColumnsByDeck(deck.id)).map((c) => [c.name, c.position])).toEqual([
      ["A", 0],
      ["C", 1],
    ]);

    const restored = await backend.restoreColumn(b.column.id);
    expect(restored.position).toBe(2);
    expect(await contents(backend, b.column.id)).toEqual([
      ["B-1", 0],
      ["B-2", 1],
    ]);
    const stillDeleted = await backend.getDeletedCards(deck.id);
    expect(stillDeleted.map((card) => card.content)).toEqual(["B-0"]);
  });

  it("refuses to restore a single card that was deleted with its column", async () => {
    const { backend, columns } = await board(["A"], 1);
    await backend.deleteColumn(columns[0].column.id);
    await expect(backend.restoreCard(columns[0].cards[0].id)).rejects.toThrow(
      "Restore the column instead",
    );
  });
});

describe("WasmBackend card restore", () => {
  it("puts a deleted card back in its original slot", async () => {
    const { backend, columns } = await board(["A"], 3);
    const [{ column, cards }] = columns;
    await backend.deleteCard(cards[1].id);
    expect(await contents(backend, column.id)).toEqual([
      ["A-0", 0],
      ["A-2", 1],
    ]);

    await backend.restoreCard(cards[1].id);
    expect(await contents(backend, column.id)).toEqual([
      ["A-0", 0],
      ["A-1", 1],
      ["A-2", 2],
    ]);
  });

  it("clamps the slot to the tail when the column has shrunk meanwhile", async () => {
    const { backend, columns } = await board(["A"], 3);
    const [{ column, cards }] = columns;
    await backend.deleteCard(cards[2].id);
    await backend.deleteCard(cards[1].id);

    await backend.restoreCard(cards[2].id);
    expect(await contents(backend, column.id)).toEqual([
      ["A-0", 0],
      ["A-2", 1],
    ]);
  });
});

describe("WasmBackend reordering keeps positions gap-free", () => {
  it("moveCard shifts the cards in between", async () => {
    const { backend, columns } = await board(["A"], 4);
    const [{ column, cards }] = columns;
    await backend.moveCard(cards[0].id, 2);
    expect(await contents(backend, column.id)).toEqual([
      ["A-1", 0],
      ["A-2", 1],
      ["A-0", 2],
      ["A-3", 3],
    ]);

    await backend.moveCard(cards[3].id, 99);
    expect((await contents(backend, column.id)).at(-1)).toEqual(["A-3", 3]);
  });

  it("moveColumn shifts the columns in between", async () => {
    const { backend, deck, columns } = await board(["A", "B", "C"], 0);
    await backend.moveColumn(columns[2].column.id, 0);
    expect((await backend.getColumnsByDeck(deck.id)).map((c) => [c.name, c.position])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
  });
});
