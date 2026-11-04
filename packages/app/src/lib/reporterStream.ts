/**
 * Card length backstop shared with the core (`query::MAX_CARD_LENGTH`), counted
 * in Unicode code points like Rust's `chars().count()`. The overlay stops
 * growing here (007-reporter-protocol.md §5.1): a Reporter that never commits
 * cannot balloon memory or rendering cost, and anything past it could not be
 * committed anyway.
 */
export const MAX_CARD_LENGTH = 4000;

/** `text` cut to at most `max` code points (never splits a surrogate pair). */
export function truncateToCodePoints(text: string, max: number): string {
  // UTF-16 length is an upper bound on the code point count.
  if (text.length <= max) return text;
  // `end` advances one code point (1 or 2 UTF-16 units) per step.
  let end = 0;
  for (let count = 0; count < max && end < text.length; count++) {
    end += text.codePointAt(end)! > 0xffff ? 2 : 1;
  }
  return text.slice(0, end);
}

interface ReporterStreamEvent {
  kind: "begin" | "delta" | "end";
  card_id: string;
  column_id?: string;
  chunk?: string;
}

interface ReporterStreamOptions {
  getStreamingText: () => Record<string, string>;
  setStreamingText: (value: Record<string, string>) => void;
  reloadColumn: (columnId: string) => Promise<void>;
  scheduleReload: () => void;
}

/**
 * Owns the ephemeral lifecycle of Reporter card streams. Persisted card state
 * remains owned by DeckData; this controller only updates the read-only overlay.
 */
export class ReporterStreamController {
  private pendingDeltas: Record<string, string> = {};
  /** Cards whose overlay hit MAX_CARD_LENGTH: later deltas are dropped outright. */
  private readonly fullCards = new Set<string>();
  private deltaFlushHandle: number | null = null;
  private streamTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private static readonly INACTIVITY_MS = 30_000;

  constructor(private readonly options: ReporterStreamOptions) {}

  handle(event: ReporterStreamEvent): void {
    switch (event.kind) {
      case "begin":
        // A new stream starts clean: nothing unflushed from a previous one.
        this.fullCards.delete(event.card_id);
        delete this.pendingDeltas[event.card_id];
        this.options.setStreamingText({
          ...this.options.getStreamingText(),
          [event.card_id]: "",
        });
        this.armTimeout(event.card_id);
        break;
      case "delta":
        this.bufferDelta(event.card_id, event.chunk ?? "");
        this.armTimeout(event.card_id);
        break;
      case "end":
        void this.endStream(event.card_id, event.column_id);
        break;
    }
  }

  stop(): void {
    if (this.deltaFlushHandle !== null) {
      cancelAnimationFrame(this.deltaFlushHandle);
      this.deltaFlushHandle = null;
    }
    for (const timer of Object.values(this.streamTimers)) clearTimeout(timer);
    this.streamTimers = {};
    this.pendingDeltas = {};
    this.fullCards.clear();
    this.options.setStreamingText({});
  }

  private armTimeout(cardId: string): void {
    this.clearTimeout(cardId);
    this.streamTimers[cardId] = setTimeout(() => {
      delete this.streamTimers[cardId];
      this.pendingDeltas = Object.fromEntries(
        Object.entries(this.pendingDeltas).filter(([id]) => id !== cardId),
      );
      this.fullCards.delete(cardId);
      const streamingText = { ...this.options.getStreamingText() };
      delete streamingText[cardId];
      this.options.setStreamingText(streamingText);
    }, ReporterStreamController.INACTIVITY_MS);
  }

  private clearTimeout(cardId: string): void {
    const timer = this.streamTimers[cardId];
    if (timer) {
      clearTimeout(timer);
      delete this.streamTimers[cardId];
    }
  }

  /** `text` capped at MAX_CARD_LENGTH; marks the card full if anything was cut. */
  private capped(cardId: string, text: string): string {
    const bounded = truncateToCodePoints(text, MAX_CARD_LENGTH);
    if (bounded.length < text.length) this.fullCards.add(cardId);
    return bounded;
  }

  private bufferDelta(cardId: string, chunk: string): void {
    // A full overlay can show nothing more, so skip the concatenation and the
    // code point scan for every later delta of this stream.
    if (this.fullCards.has(cardId)) return;
    // Bounded between frames too: more than a full card could never be shown.
    this.pendingDeltas[cardId] = this.capped(
      cardId,
      (this.pendingDeltas[cardId] ?? "") + chunk,
    );
    if (this.deltaFlushHandle !== null) return;
    this.deltaFlushHandle = requestAnimationFrame(() => {
      this.deltaFlushHandle = null;
      const pending = this.pendingDeltas;
      this.pendingDeltas = {};
      const streamingText = { ...this.options.getStreamingText() };
      for (const [id, text] of Object.entries(pending)) {
        if (streamingText[id] === undefined) continue;
        streamingText[id] = this.capped(id, streamingText[id] + text);
      }
      this.options.setStreamingText(streamingText);
    });
  }

  private async endStream(cardId: string, columnId?: string): Promise<void> {
    try {
      if (columnId) await this.options.reloadColumn(columnId);
      else this.options.scheduleReload();
    } catch (error) {
      console.error(`Failed to reload after stream end for ${cardId}:`, error);
    } finally {
      this.clearTimeout(cardId);
      const streamingText = { ...this.options.getStreamingText() };
      delete streamingText[cardId];
      this.options.setStreamingText(streamingText);
      delete this.pendingDeltas[cardId];
      this.fullCards.delete(cardId);
    }
  }
}
