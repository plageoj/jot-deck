// User-approval-based updater. Power-user app: never auto-install while
// the user may be mid-edit. Flow: check → notify → user clicks install
// → download+install → relaunch.

type UpdateInfo = {
  version: string;
  currentVersion: string;
  notes?: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "up-to-date" }
  | { kind: "downloading"; downloaded: number; contentLength?: number }
  | { kind: "installing" }
  | { kind: "error"; message: string };

function isTauri(): boolean {
  return (
    typeof globalThis.window !== "undefined" &&
    "__TAURI_INTERNALS__" in globalThis
  );
}

class UpdaterStore {
  status = $state<Status>({ kind: "idle" });
  private update: unknown = null;

  async check(): Promise<void> {
    if (!isTauri()) return;
    if (
      this.status.kind === "checking" ||
      this.status.kind === "downloading" ||
      this.status.kind === "installing"
    ) {
      return;
    }
    this.status = { kind: "checking" };
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        this.update = update;
        this.status = {
          kind: "available",
          info: {
            version: update.version,
            currentVersion: update.currentVersion,
            notes: update.body,
          },
        };
      } else {
        this.status = { kind: "up-to-date" };
      }
    } catch (err) {
      this.status = {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async installAndRelaunch(): Promise<void> {
    if (!isTauri()) return;
    const update = this.update as
      | { downloadAndInstall: (cb: (e: DownloadEvent) => void) => Promise<void> }
      | null;
    if (!update) return;
    let contentLength: number | undefined;
    let downloaded = 0;
    this.status = { kind: "downloading", downloaded: 0 };
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          this.status = { kind: "downloading", downloaded: 0, contentLength };
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          this.status = { kind: "downloading", downloaded, contentLength };
        } else if (event.event === "Finished") {
          this.status = { kind: "installing" };
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      this.status = {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  dismiss(): void {
    if (this.status.kind === "available" || this.status.kind === "up-to-date" || this.status.kind === "error") {
      this.status = { kind: "idle" };
    }
  }
}

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export const updaterStore = new UpdaterStore();
