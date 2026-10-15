import { describe, it, expect, vi } from "vitest";
import { WasmBackend } from "./wasm-backend";

// jsdom cannot fetch the Vite asset path, so hand sql.js the same bundled
// binary inline (Node's fetch supports data: URLs).
vi.mock("sql.js/dist/sql-wasm-browser.wasm?url", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const binary = readFileSync(
    require.resolve("sql.js/dist/sql-wasm-browser.wasm"),
  );
  return {
    default: `data:application/wasm;base64,${binary.toString("base64")}`,
  };
});

// The browser backend cannot spawn child processes, so the Reporter surface is
// deliberately inert there (007-reporter-protocol.md): reads answer empty so the
// UI renders an empty list rather than an error, writes reject with a reason.
describe("WasmBackend reporter surface", () => {
  const backend = new WasmBackend();

  it("reports no registered or running reporters", async () => {
    expect(await backend.listReporters()).toEqual([]);
    expect(await backend.listRunningReporters()).toEqual([]);
  });

  it.each([
    ["addReporter", () => backend.addReporter()],
    ["updateReporter", () => backend.updateReporter()],
    ["removeReporter", () => backend.removeReporter()],
    ["startReporter", () => backend.startReporter()],
    ["stopReporter", () => backend.stopReporter()],
  ])("%s rejects as desktop-only", async (_name, call) => {
    await expect(call()).rejects.toThrow(
      "Reporters are only available in the desktop app.",
    );
  });
});

describe("WasmBackend GUI card edit surface", () => {
  it("locks, lease-aware CAS-updates, and atomically releases a card", async () => {
    const backend = new WasmBackend();
    const deck = await backend.createDeck({ name: "Test deck" });
    const column = await backend.createColumn({
      deck_id: deck.id,
      name: "Inbox",
    });
    const card = await backend.createCard({
      column_id: column.id,
      content: "before #old",
    });

    const locked = await backend.acquireCardLock(card.id, "user");
    expect(locked.id).toBe(card.id);

    const updated = await backend.updateCardContentCasAndRelease(
      card.id,
      "user",
      "after #new",
      locked.updated_at,
    );
    expect(updated.content).toBe("after #new");
    expect(updated.locked_by).toBeNull();
    expect(updated.locked_at).toBeNull();
  });

  it("does not let a non-owner save or release another editor's lease", async () => {
    const backend = new WasmBackend();
    const deck = await backend.createDeck({ name: "Test deck" });
    const column = await backend.createColumn({ deck_id: deck.id, name: "Inbox" });
    const card = await backend.createCard({ column_id: column.id, content: "before" });
    const locked = await backend.acquireCardLock(card.id, "owner");

    await expect(
      backend.updateCardContentCasOwned(card.id, "other", "after", locked.updated_at),
    ).rejects.toThrow("Card edit lock is not held");
    await backend.releaseCardLock(card.id, "other");

    const unchanged = await backend.getCard(card.id);
    expect(unchanged.content).toBe("before");
    expect(unchanged.locked_by).toBe("owner");
  });

  it("discards an owned blank card and compacts positions", async () => {
    const backend = new WasmBackend();
    const deck = await backend.createDeck({ name: "Test deck" });
    const column = await backend.createColumn({ deck_id: deck.id, name: "Inbox" });
    const empty = await backend.createCard({ column_id: column.id, content: " " });
    const after = await backend.createCard({ column_id: column.id, content: "after" });
    await backend.acquireCardLock(empty.id, "owner");

    await backend.discardEmptyCard(empty.id, "owner");

    const cards = await backend.getCardsByColumn(column.id);
    expect(cards.map((c) => [c.id, c.position])).toEqual([[after.id, 0]]);
    expect(await backend.getDeletedCards(deck.id)).toEqual([]);
  });

  it("refuses to discard a card with content, another owner, or an expired lease", async () => {
    const backend = new WasmBackend();
    const deck = await backend.createDeck({ name: "Test deck" });
    const column = await backend.createColumn({ deck_id: deck.id, name: "Inbox" });
    const filled = await backend.createCard({ column_id: column.id, content: "keep" });
    await backend.acquireCardLock(filled.id, "owner");
    await expect(backend.discardEmptyCard(filled.id, "owner")).rejects.toThrow();

    const empty = await backend.createCard({ column_id: column.id, content: "" });
    await backend.acquireCardLock(empty.id, "other");
    await expect(backend.discardEmptyCard(empty.id, "owner")).rejects.toThrow();

    await backend.acquireCardLock(empty.id, "owner").catch(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 121_000);
      await expect(backend.discardEmptyCard(empty.id, "other")).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }

    expect(await backend.getCardsByColumn(column.id)).toHaveLength(2);
  });

  it("rejects a stale CAS update without changing the card", async () => {
    const backend = new WasmBackend();
    const deck = await backend.createDeck({ name: "Test deck" });
    const column = await backend.createColumn({
      deck_id: deck.id,
      name: "Inbox",
    });
    const card = await backend.createCard({
      column_id: column.id,
      content: "before",
    });

    await expect(
      backend.updateCardContentCas(card.id, "after", "stale-version"),
    ).rejects.toThrow("Card was modified since it was read");
    expect((await backend.getCard(card.id)).content).toBe("before");
  });
});
