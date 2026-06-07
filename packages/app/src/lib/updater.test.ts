import { describe, it, expect } from "vitest";
import { updaterStore } from "./updater.svelte";

describe("updaterStore outside Tauri", () => {
  it("check() is a no-op when not running inside Tauri", async () => {
    // jsdom has no __TAURI_INTERNALS__, so isTauri() is false and check()
    // returns early without touching the update status.
    await updaterStore.check();
    expect(updaterStore.status.kind).toBe("idle");
  });
});
