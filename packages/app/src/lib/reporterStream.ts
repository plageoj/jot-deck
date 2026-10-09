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
  private deltaFlushHandle: number | null = null;
  private streamTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private static readonly INACTIVITY_MS = 30_000;

  constructor(private readonly options: ReporterStreamOptions) {}

  handle(event: ReporterStreamEvent): void {
    switch (event.kind) {
      case "begin":
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
    this.options.setStreamingText({});
  }

  private armTimeout(cardId: string): void {
    this.clearTimeout(cardId);
    this.streamTimers[cardId] = setTimeout(() => {
      delete this.streamTimers[cardId];
      this.pendingDeltas = Object.fromEntries(
        Object.entries(this.pendingDeltas).filter(([id]) => id !== cardId),
      );
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

  private bufferDelta(cardId: string, chunk: string): void {
    this.pendingDeltas[cardId] = (this.pendingDeltas[cardId] ?? "") + chunk;
    if (this.deltaFlushHandle !== null) return;
    this.deltaFlushHandle = requestAnimationFrame(() => {
      this.deltaFlushHandle = null;
      const pending = this.pendingDeltas;
      this.pendingDeltas = {};
      const streamingText = { ...this.options.getStreamingText() };
      for (const [id, text] of Object.entries(pending)) {
        if (streamingText[id] === undefined) continue;
        streamingText[id] += text;
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
    }
  }
}
