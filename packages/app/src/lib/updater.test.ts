import { afterEach, describe, it, expect, vi } from "vitest";
import { updaterStore } from "./updater.svelte";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

afterEach(() => {
  updaterStore.status = { kind: "idle" };
  vi.unstubAllGlobals();
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
});
