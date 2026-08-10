import { describe, it, expect } from "vitest";
import { WasmBackend } from "./wasm-backend";

// The browser backend cannot spawn child processes, so the Reporter surface is
// deliberately inert there (007-reporter-protocol.md): reads answer empty so the
// UI renders an empty list rather than an error, writes reject with a reason.
describe("WasmBackend reporter surface", () => {
  const backend = new WasmBackend();

  it("reports no registered or running reporters", async () => {
    expect(await backend.listReporters()).toEqual([]);
    expect(await backend.listRunningReporters()).toEqual([]);
  });

  it.each([
    ["addReporter", () => backend.addReporter()],
    ["updateReporter", () => backend.updateReporter()],
    ["removeReporter", () => backend.removeReporter()],
    ["startReporter", () => backend.startReporter()],
    ["stopReporter", () => backend.stopReporter()],
  ])("%s rejects as desktop-only", async (_name, call) => {
    await expect(call()).rejects.toThrow(
      "Reporters are only available in the desktop app.",
    );
  });
});
