import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsTauri, mockListen } = vi.hoisted(() => ({
  mockIsTauri: vi.fn(() => true),
  mockListen: vi.fn(),
}));

vi.mock("#lib/db/index.ts", () => ({
  isTauri: mockIsTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

import { ExternalChangeEvents } from "./externalChangeEvents";

// Tauri event subscription lifecycle and debounced persisted-data change
// notifications. Reporter stream payloads are only forwarded here; their
// overlay lifecycle is covered by reporterStream.test.ts.

describe("ExternalChangeEvents subscriptions", () => {
  let handlers: Record<string, (event?: { payload: unknown }) => void>;
  let unlisteners: Record<string, ReturnType<typeof vi.fn>>;
  let onExternalChange: ReturnType<typeof vi.fn<() => void>>;
  let onReporterStream: ReturnType<typeof vi.fn<(event: unknown) => void>>;
  let events: ExternalChangeEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    mockIsTauri.mockReturnValue(true);
    handlers = {};
    unlisteners = {};
    mockListen.mockReset();
    mockListen.mockImplementation(
      async (event: string, handler: (event?: { payload: unknown }) => void) => {
        handlers[event] = handler;
        unlisteners[event] = vi.fn();
        return unlisteners[event];
      },
    );
    onExternalChange = vi.fn();
    onReporterStream = vi.fn();
    events = new ExternalChangeEvents({ onExternalChange, onReporterStream });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a no-op outside Tauri", async () => {
    mockIsTauri.mockReturnValue(false);

    await events.start();

    expect(mockListen).not.toHaveBeenCalled();
    expect(onExternalChange).not.toHaveBeenCalled();
  });

  it("subscribes to every channel and reconciles once after subscribing", async () => {
    await events.start();

    expect(Object.keys(handlers)).toEqual([
      "external-db-change",
      "reporter-change",
      "reporter-stream",
    ]);
    expect(onExternalChange).toHaveBeenCalledOnce();
  });

  it("coalesces a burst of DB and Reporter commits into one debounced notification", async () => {
    await events.start();
    onExternalChange.mockClear();

    handlers["external-db-change"]();
    handlers["reporter-change"]();
    handlers["external-db-change"](); // burst within the debounce window
    vi.advanceTimersByTime(249);
    expect(onExternalChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onExternalChange).toHaveBeenCalledOnce();
  });

  it("forwards reporter-stream payloads without debouncing", async () => {
    await events.start();
    const payload = { kind: "begin", card_id: "card-1" };

    handlers["reporter-stream"]({ payload });

    expect(onReporterStream).toHaveBeenCalledWith(payload);
  });

  it("stop clears a pending debounce and unsubscribes every listener", async () => {
    await events.start();
    onExternalChange.mockClear();

    handlers["external-db-change"](); // schedule a debounced notification…
    events.stop(); // …then cancel it before it fires
    vi.advanceTimersByTime(500);

    expect(onExternalChange).not.toHaveBeenCalled();
    for (const unlisten of Object.values(unlisteners)) {
      expect(unlisten).toHaveBeenCalledOnce();
    }
  });

  it("stop is safe when nothing is subscribed", () => {
    expect(() => events.stop()).not.toThrow();
  });
});

describe("ExternalChangeEvents lifecycle", () => {
  beforeEach(() => {
    mockIsTauri.mockReturnValue(true);
    mockListen.mockReset();
  });

  it("unregisters earlier listeners when a later registration fails", async () => {
    const firstUnlisten = vi.fn();
    mockListen
      .mockResolvedValueOnce(firstUnlisten)
      .mockRejectedValueOnce(new Error("registration failed"));
    const events = new ExternalChangeEvents({
      onExternalChange: vi.fn(),
      onReporterStream: vi.fn(),
    });

    await expect(events.start()).rejects.toThrow("registration failed");

    expect(firstUnlisten).toHaveBeenCalledOnce();
    expect(mockListen).toHaveBeenCalledTimes(2);
  });

  it("unregisters a listener that resolves after stop invalidates startup", async () => {
    const firstUnlisten = vi.fn();
    const lateUnlisten = vi.fn();
    let resolveSecond!: (unlisten: () => void) => void;
    mockListen
      .mockResolvedValueOnce(firstUnlisten)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const onExternalChange = vi.fn();
    const events = new ExternalChangeEvents({
      onExternalChange,
      onReporterStream: vi.fn(),
    });

    const startup = events.start();
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalledTimes(2));
    events.stop();
    expect(firstUnlisten).toHaveBeenCalledOnce();

    resolveSecond(lateUnlisten);
    await startup;

    expect(lateUnlisten).toHaveBeenCalledOnce();
    expect(mockListen).toHaveBeenCalledTimes(2);
    expect(onExternalChange).not.toHaveBeenCalled();
  });
});
