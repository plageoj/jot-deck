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

  constructor(private readonly options: ExternalChangeEventsOptions) {}

  async start(): Promise<void> {
    if (!isTauri() || this.unlisten.length > 0) return;
    const { listen } = await import("@tauri-apps/api/event");
    this.unlisten.push(
      await listen("external-db-change", () => this.requestExternalChange()),
    );
    this.unlisten.push(
      await listen("reporter-change", () => this.requestExternalChange()),
    );
    this.unlisten.push(
      await listen<ReporterStreamEvent>("reporter-stream", ({ payload }) => {
        this.options.onReporterStream(payload);
      }),
    );
    // Reconcile once after subscribing in case a commit landed between the
    // initial load and listener registration.
    this.options.onExternalChange();
  }

  stop(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
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
