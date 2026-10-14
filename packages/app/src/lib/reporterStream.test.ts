import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ReporterStreamController } from "./reporterStream";

// Ephemeral Reporter stream overlay lifecycle: begin/delta/end handling,
// animation-frame delta batching, late-delta handling, stalled-stream
// eviction, and cleanup. Persisted-card reloads are delegated through the
// constructor options and observed here as calls.

describe("ReporterStreamController", () => {
  let streamingText: Record<string, string>;
  let reloadColumn: ReturnType<typeof vi.fn<(columnId: string) => Promise<void>>>;
  let scheduleReload: ReturnType<typeof vi.fn<() => void>>;
  let setStreamingText: ReturnType<typeof vi.fn<(value: Record<string, string>) => void>>;
  let streams: ReporterStreamController;

  /** Run the pending animation-frame delta flush (fake timers fake rAF too). */
  function flushFrame(): void {
    vi.advanceTimersByTime(20);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    streamingText = {};
    reloadColumn = vi.fn(async () => {});
    scheduleReload = vi.fn();
    setStreamingText = vi.fn((value) => {
      streamingText = value;
    });
    streams = new ReporterStreamController({
      getStreamingText: () => streamingText,
      setStreamingText,
      reloadColumn,
      scheduleReload,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("begin opens the overlay before any delta arrives", () => {
    streams.handle({ kind: "begin", card_id: "card-1" });

    expect(streamingText).toEqual({ "card-1": "" });
  });

  it("coalesces a burst of deltas into one flush of concatenated text", () => {
    streams.handle({ kind: "begin", card_id: "card-1" });
    setStreamingText.mockClear();
    streams.handle({ kind: "delta", card_id: "card-1", chunk: "Hel" });
    streams.handle({ kind: "delta", card_id: "card-1", chunk: "lo " });
    streams.handle({ kind: "delta", card_id: "card-1", chunk: "world" });

    // Nothing is painted until the frame runs — deltas are buffered, not applied.
    expect(streamingText["card-1"]).toBe("");
    flushFrame();
    expect(streamingText["card-1"]).toBe("Hello world");
    expect(setStreamingText).toHaveBeenCalledOnce();
  });

  it("treats a missing chunk as empty and keeps the overlay open", () => {
    streams.handle({ kind: "begin", card_id: "card-1" });
    streams.handle({ kind: "delta", card_id: "card-1" });
    flushFrame();

    expect(streamingText).toEqual({ "card-1": "" });
  });

  it("drops a delta that lands after the stream already ended", async () => {
    streams.handle({ kind: "begin", card_id: "card-1" });
    streams.handle({ kind: "end", card_id: "card-1", column_id: "col-active" });
    await vi.runAllTimersAsync();

    // A straggler delta must not resurrect the overlay on the committed card.
    streams.handle({ kind: "delta", card_id: "card-1", chunk: "late" });
    flushFrame();

    expect(streamingText["card-1"]).toBeUndefined();
  });

  it("end reloads the streamed card's column before dropping the overlay", async () => {
    let overlayDuringReload: string | undefined;
    reloadColumn.mockImplementation(async () => {
      overlayDuringReload = streamingText["card-1"];
    });
    streams.handle({ kind: "begin", card_id: "card-1" });

    streams.handle({ kind: "end", card_id: "card-1", column_id: "col-active" });
    await vi.runAllTimersAsync();

    expect(reloadColumn).toHaveBeenCalledWith("col-active");
    expect(scheduleReload).not.toHaveBeenCalled();
    expect(overlayDuringReload).toBe("");
    expect(streamingText["card-1"]).toBeUndefined();
  });

  it("end without a column falls back to a scheduled full reconcile", async () => {
    streams.handle({ kind: "begin", card_id: "card-1" });

    streams.handle({ kind: "end", card_id: "card-1" });
    await vi.runAllTimersAsync();

    expect(scheduleReload).toHaveBeenCalledOnce();
    expect(reloadColumn).not.toHaveBeenCalled();
    expect(streamingText["card-1"]).toBeUndefined();
  });

  it("drops the overlay even when the post-stream reload fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    reloadColumn.mockRejectedValue(new Error("db gone"));
    streams.handle({ kind: "begin", card_id: "card-1" });

    streams.handle({ kind: "end", card_id: "card-1", column_id: "col-active" });
    await vi.runAllTimersAsync();

    // A failed reload must not leave the card stuck read-only.
    expect(streamingText["card-1"]).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("evicts a stalled stream so a dead Reporter cannot pin a card read-only", () => {
    streams.handle({ kind: "begin", card_id: "card-1" });
    streams.handle({ kind: "delta", card_id: "card-1", chunk: "half a sen" });
    flushFrame();

    // Deltas keep re-arming the timer; silence past the window evicts.
    vi.advanceTimersByTime(29_000);
    expect(streamingText["card-1"]).toBe("half a sen");
    vi.advanceTimersByTime(30_000);

    expect(streamingText["card-1"]).toBeUndefined();
  });

  it("stop clears every overlay, timer, and pending frame", () => {
    streams.handle({ kind: "begin", card_id: "card-1" });
    streams.handle({ kind: "delta", card_id: "card-1", chunk: "unflushed" });

    streams.stop();
    expect(streamingText).toEqual({});

    // Neither the pending frame nor the inactivity timer may fire afterwards.
    setStreamingText.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(setStreamingText).not.toHaveBeenCalled();
  });
});
