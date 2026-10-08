import { isTauri } from "#lib/db/index.ts";

interface ReporterStreamEvent {
  kind: "begin" | "delta" | "end";
  card_id: string;
  column_id?: string;
  chunk?: string;
}

interface ExternalChangeEventsOptions {
  onExternalChange: () => void;
  onReporterStream: (event: ReporterStreamEvent) => void;
}

/** Owns Tauri event subscriptions and coalesces persisted-data change signals. */
export class ExternalChangeEvents {
  private unlisten: Array<() => void> = [];
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private startGeneration = 0;
  private starting = false;

  constructor(private readonly options: ExternalChangeEventsOptions) {}

  async start(): Promise<void> {
    if (!isTauri() || this.starting || this.unlisten.length > 0) return;
    this.starting = true;
    const generation = this.startGeneration;

    try {
      const { listen } = await import("@tauri-apps/api/event");
      if (generation !== this.startGeneration) return;

      const externalChange = await listen("external-db-change", () =>
        this.requestExternalChange(),
      );
      if (generation !== this.startGeneration) {
        externalChange();
        return;
      }
      this.unlisten = this.unlisten.concat(externalChange);

      const reporterChange = await listen("reporter-change", () =>
        this.requestExternalChange(),
      );
      if (generation !== this.startGeneration) {
        reporterChange();
        return;
      }
      this.unlisten = this.unlisten.concat(reporterChange);

      const reporterStream = await listen<ReporterStreamEvent>(
        "reporter-stream",
        ({ payload }) => this.options.onReporterStream(payload),
      );
      if (generation !== this.startGeneration) {
        reporterStream();
        return;
      }
      this.unlisten = this.unlisten.concat(reporterStream);

      // Reconcile once after subscribing in case a commit landed between the
      // initial load and listener registration.
      this.options.onExternalChange();
    } catch (error) {
      if (generation === this.startGeneration) {
        this.clearListeners();
        throw error;
      }
    } finally {
      if (generation === this.startGeneration) this.starting = false;
    }
  }

  stop(): void {
    this.startGeneration++;
    this.starting = false;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.clearListeners();
  }

  private clearListeners(): void {
    for (const unlisten of this.unlisten) unlisten();
    this.unlisten = [];
  }

  requestExternalChange(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.options.onExternalChange();
    }, 250);
  }
}
