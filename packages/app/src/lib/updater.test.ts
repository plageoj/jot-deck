import { afterEach, describe, it, expect, vi } from "vitest";
import { updaterStore } from "./updater.svelte";

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

afterEach(() => {
  updaterStore.status = { kind: "idle" };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("updaterStore outside Tauri", () => {
  it("check() is a no-op when not running inside Tauri", async () => {
    // jsdom has no __TAURI_INTERNALS__, so isTauri() is false and check()
    // returns early without touching the update status.
    await updaterStore.check();
    expect(updaterStore.status.kind).toBe("idle");
  });
});

describe("updaterStore inside Tauri", () => {
  it("records a failed check as a check-phase error", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockRejectedValueOnce(new Error("network unreachable"));

    await updaterStore.check();

    expect(updaterStore.status).toEqual({
      kind: "error",
      phase: "check",
      message: "network unreachable",
    });
  });

  it("retries a failed check when the network comes back", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockRejectedValueOnce(new Error("network unreachable"));
    await updaterStore.check();

    vi.mocked(check).mockResolvedValueOnce(null);
    updaterStore.handleOnline();
    await vi.waitFor(() => expect(updaterStore.status.kind).toBe("up-to-date"));
  });

  it("retries a check that fails after the network came back mid-check", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const { check } = await import("@tauri-apps/plugin-updater");
    let rejectFirst!: (err: Error) => void;
    vi.mocked(check)
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
      .mockResolvedValueOnce(null);

    const pending = updaterStore.check();
    await vi.waitFor(() => expect(rejectFirst).toBeDefined());
    updaterStore.handleOnline();
    rejectFirst(new Error("network unreachable"));
    await pending;

    await vi.waitFor(() => expect(updaterStore.status.kind).toBe("up-to-date"));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("does not re-check on reconnect unless the last check failed", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const spy = vi.spyOn(updaterStore, "check");

    updaterStore.status = { kind: "up-to-date" };
    updaterStore.handleOnline();
    updaterStore.status = { kind: "error", phase: "install", message: "disk full" };
    updaterStore.handleOnline();

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("updaterStore install flow", () => {
  type DownloadEvent =
    | { event: "Started"; data: { contentLength?: number } }
    | { event: "Progress"; data: { chunkLength: number } }
    | { event: "Finished" };

  function fakeUpdate(downloadAndInstall: (cb: (e: DownloadEvent) => void) => Promise<void>) {
    return { version: "9.9.9", currentVersion: "1.0.0", body: "notes", downloadAndInstall };
  }

  async function findUpdate(update: ReturnType<typeof fakeUpdate>) {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockResolvedValueOnce(update as never);
    await updaterStore.check();
  }

  it("reports a found update as available with its version info", async () => {
    await findUpdate(fakeUpdate(async () => {}));
    expect(updaterStore.status).toEqual({
      kind: "available",
      info: { version: "9.9.9", currentVersion: "1.0.0", notes: "notes" },
    });
  });

  it("tracks download progress, then installs and relaunches", async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    const seen: unknown[] = [];
    await findUpdate(
      fakeUpdate(async (cb) => {
        cb({ event: "Started", data: { contentLength: 100 } });
        cb({ event: "Progress", data: { chunkLength: 40 } });
        seen.push({ ...updaterStore.status });
        cb({ event: "Progress", data: { chunkLength: 60 } });
        seen.push({ ...updaterStore.status });
        cb({ event: "Finished" });
        seen.push({ ...updaterStore.status });
      }),
    );

    await updaterStore.installAndRelaunch();

    expect(seen).toEqual([
      { kind: "downloading", downloaded: 40, contentLength: 100 },
      { kind: "downloading", downloaded: 100, contentLength: 100 },
      { kind: "installing" },
    ]);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("records an install failure as an install-phase error", async () => {
    await findUpdate(
      fakeUpdate(async () => {
        throw new Error("disk full");
      }),
    );
    await updaterStore.installAndRelaunch();
    expect(updaterStore.status).toEqual({ kind: "error", phase: "install", message: "disk full" });
  });

  it("ignores a new check while a download is running", async () => {
    let finish: (() => void) | undefined;
    await findUpdate(fakeUpdate(() => new Promise<void>((resolve) => (finish = resolve))));
    const { check } = await import("@tauri-apps/plugin-updater");
    vi.mocked(check).mockClear();

    const installing = updaterStore.installAndRelaunch();
    await vi.waitFor(() => expect(finish).toBeDefined());
    await updaterStore.check();
    expect(check).not.toHaveBeenCalled();
    expect(updaterStore.status.kind).toBe("downloading");

    finish!();
    await installing;
  });

  it("ignores a second check while one is in flight", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    const { check } = await import("@tauri-apps/plugin-updater");
    let resolveFirst: ((value: null) => void) | undefined;
    vi.mocked(check).mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );

    const first = updaterStore.check();
    await vi.waitFor(() => expect(resolveFirst).toBeDefined());
    await updaterStore.check();
    expect(check).toHaveBeenCalledTimes(1);

    resolveFirst!(null);
    await first;
    expect(updaterStore.status.kind).toBe("up-to-date");
  });

  it("dismiss returns to idle from a settled state but not mid-download", () => {
    updaterStore.status = { kind: "available", info: { version: "9.9.9", currentVersion: "1.0.0" } };
    updaterStore.dismiss();
    expect(updaterStore.status.kind).toBe("idle");

    updaterStore.status = { kind: "error", phase: "install", message: "x" };
    updaterStore.dismiss();
    expect(updaterStore.status.kind).toBe("idle");

    updaterStore.status = { kind: "downloading", downloaded: 1 };
    updaterStore.dismiss();
    expect(updaterStore.status.kind).toBe("downloading");
  });
});
