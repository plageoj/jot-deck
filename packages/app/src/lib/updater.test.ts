import { afterEach, describe, it, expect, vi } from "vitest";
import { updaterStore } from "./updater.svelte";

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
