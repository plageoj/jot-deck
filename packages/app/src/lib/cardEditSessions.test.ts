import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { Card } from "#lib/types.ts";
import { CardEditSessions } from "./cardEditSessions";
import { makeCard } from "./__fixtures__/models";

let version = 0;
const nextVersion = () => `2026-01-01T00:00:${String(++version).padStart(2, "0")}Z`;

function lockedCard(id: string, owner: string | null, content = "content"): Card {
  return {
    ...makeCard(id, "col-1", { content, lockedBy: owner }),
    updated_at: nextVersion(),
  };
}

function createSessions() {
  const backend = {
    acquireCardLock: vi.fn(async (id: string, owner: string) => lockedCard(id, owner)),
    updateCardContentCasOwned: vi.fn(
      async (id: string, owner: string, content: string, _expected: string) =>
        lockedCard(id, owner, content),
    ),
    updateCardContentCasAndRelease: vi.fn(
      async (id: string, _owner: string, content: string, _expected: string) =>
        lockedCard(id, null, content),
    ),
    releaseCardLock: vi.fn(async (id: string, _owner: string) => lockedCard(id, null)),
    discardEmptyCard: vi.fn(async (_id: string, _owner: string) => {}),
  };
  const onCardChanged = vi.fn<(card: Card) => void>();
  const onRenewalError = vi.fn<(error: unknown) => void>();
  const sessions = new CardEditSessions({
    getBackend: () => backend,
    onCardChanged,
    onRenewalError,
  });
  return { backend, sessions, onCardChanged, onRenewalError };
}

describe("CardEditSessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses the active session for the same card and reports the locked card", async () => {
    const { backend, sessions, onCardChanged } = createSessions();

    const first = await sessions.start("card-1");
    expect(await sessions.start("card-1")).toBe(first);
    expect(backend.acquireCardLock).toHaveBeenCalledTimes(1);
    expect(onCardChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: "card-1", locked_by: first.owner }),
    );
    expect(sessions.isActive(first)).toBe(true);
  });

  it("gives every new session a fresh owner", async () => {
    const { sessions } = createSessions();

    const first = await sessions.start("card-1");
    await sessions.release(first);
    const second = await sessions.start("card-1");

    expect(second.owner).not.toBe(first.owner);
    expect(sessions.isActive(first)).toBe(false);
  });

  it("discards the card with the session's owner and ends the session", async () => {
    const { backend, sessions } = createSessions();
    const session = await sessions.start("card-1");

    await sessions.discard(session);

    expect(backend.discardEmptyCard).toHaveBeenCalledWith("card-1", session.owner);
    expect(backend.releaseCardLock).not.toHaveBeenCalled();
    expect(sessions.isActive(session)).toBe(false);
  });

  it("keeps the session after a failed discard so it can be retried", async () => {
    const { backend, sessions } = createSessions();
    backend.discardEmptyCard.mockRejectedValueOnce(new Error("temporary failure"));
    const session = await sessions.start("card-1");

    await expect(sessions.discard(session)).rejects.toThrow("temporary failure");
    expect(sessions.isActive(session)).toBe(true);
    await sessions.discard(session);
    expect(sessions.isActive(session)).toBe(false);
  });

  it("does not enter a session when lock acquisition fails", async () => {
    const { backend, sessions } = createSessions();
    backend.acquireCardLock.mockRejectedValueOnce(new Error("locked"));

    await expect(sessions.start("card-1")).rejects.toThrow("locked");
    const session = await sessions.start("card-1");
    expect(backend.acquireCardLock).toHaveBeenCalledTimes(2);
    expect(sessions.isActive(session)).toBe(true);
  });

  it("saves with the session version and advances it for the next save", async () => {
    const { backend, sessions } = createSessions();
    const session = await sessions.start("card-1");
    const startVersion = session.expectedUpdatedAt;

    const saved = await sessions.save(session, "next", false);

    expect(backend.updateCardContentCasOwned).toHaveBeenCalledWith(
      "card-1",
      session.owner,
      "next",
      startVersion,
    );
    expect(session.expectedUpdatedAt).toBe(saved.updated_at);
    expect(sessions.isActive(session)).toBe(true);
  });

  it("ends the session after an atomic save-and-release", async () => {
    const { backend, sessions } = createSessions();
    const session = await sessions.start("card-1");

    await sessions.save(session, "final", true);

    expect(backend.updateCardContentCasAndRelease).toHaveBeenCalledOnce();
    expect(sessions.isActive(session)).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.acquireCardLock).toHaveBeenCalledTimes(1);
  });

  it("keeps renewing a session whose save-and-release failed", async () => {
    const { backend, sessions } = createSessions();
    const session = await sessions.start("card-1");
    backend.updateCardContentCasAndRelease.mockRejectedValueOnce(new Error("conflict"));

    await expect(sessions.save(session, "final", true)).rejects.toThrow("conflict");

    expect(sessions.isActive(session)).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.acquireCardLock).toHaveBeenCalledTimes(2);
  });

  it("keeps a session whose release failed so it can be retried", async () => {
    const { backend, sessions } = createSessions();
    const session = await sessions.start("card-1");
    backend.releaseCardLock.mockRejectedValueOnce(new Error("temporary"));

    await expect(sessions.release(session)).rejects.toThrow("temporary");
    expect(sessions.isActive(session)).toBe(true);

    await sessions.release(session);
    expect(sessions.isActive(session)).toBe(false);
    expect(backend.releaseCardLock).toHaveBeenCalledTimes(2);
  });

  it("treats releasing an inactive session as a no-op", async () => {
    const { backend, sessions } = createSessions();
    const session = await sessions.start("card-1");
    await sessions.release(session);

    await sessions.release(session);
    expect(backend.releaseCardLock).toHaveBeenCalledTimes(1);
  });

  it("renews an active lease and stops renewal after release", async () => {
    const { backend, sessions, onCardChanged } = createSessions();
    const session = await sessions.start("card-1");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.acquireCardLock).toHaveBeenCalledTimes(2);
    expect(backend.acquireCardLock).toHaveBeenLastCalledWith("card-1", session.owner);
    expect(onCardChanged).toHaveBeenCalledTimes(2);

    await sessions.release(session);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.acquireCardLock).toHaveBeenCalledTimes(2);
  });

  it("reports a failed renewal without ending the session", async () => {
    const { backend, sessions, onRenewalError } = createSessions();
    const session = await sessions.start("card-1");
    backend.acquireCardLock.mockRejectedValueOnce(new Error("expired"));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(onRenewalError).toHaveBeenCalledWith(new Error("expired"));
    expect(sessions.isActive(session)).toBe(true);
  });

  it("waits for an in-flight renewal before releasing and ignores its result", async () => {
    const { backend, sessions, onCardChanged, onRenewalError } = createSessions();
    const session = await sessions.start("card-1");
    let failRenewal!: (error: Error) => void;
    backend.acquireCardLock.mockImplementationOnce(
      () =>
        new Promise<Card>((_resolve, reject) => {
          failRenewal = reject;
        }),
    );
    vi.advanceTimersByTime(30_000);
    onCardChanged.mockClear();

    const releasing = sessions.release(session);
    await Promise.resolve();
    expect(backend.releaseCardLock).not.toHaveBeenCalled();

    failRenewal(new Error("raced with release"));
    await releasing;
    expect(backend.releaseCardLock).toHaveBeenCalledWith("card-1", session.owner);
    expect(onRenewalError).not.toHaveBeenCalled();
    expect(onCardChanged).toHaveBeenCalledTimes(1);
    expect(onCardChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: "card-1", locked_by: null }),
    );
  });
});
