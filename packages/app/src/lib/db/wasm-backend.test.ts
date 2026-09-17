import { describe, it, expect } from "vitest";
import { WasmBackend } from "./wasm-backend";

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
  it("locks, CAS-updates, and releases a card", async () => {
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

    const updated = await backend.updateCardContentCas(
      card.id,
      "after #new",
      locked.updated_at,
    );
    expect(updated.content).toBe("after #new");

    const released = await backend.releaseCardLock(card.id, "user");
    expect(released.content).toBe("after #new");
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
