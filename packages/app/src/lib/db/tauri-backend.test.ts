import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReporterConfig } from "../types";

// Capture what the backend hands to Tauri: these methods are a naming contract
// with the Rust commands, so the command name and argument shape are the whole
// behaviour worth pinning (007-reporter-protocol.md).
const invoke = vi.fn(async (_cmd: string, _args?: unknown) => undefined as never);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { TauriBackend } = await import("./tauri-backend");

const config: ReporterConfig = {
  reporter_id: "rep-1",
  name: "Minutes",
  command: "/opt/whisper",
  args: ["--model", "small"],
  env: { TOKEN: "abc" },
  deny: ["delete"],
  max_writes_per_min: 30,
  allowed_columns: ["col-1"],
};

describe("TauriBackend reporter surface", () => {
  let backend: InstanceType<typeof TauriBackend>;

  beforeEach(() => {
    invoke.mockClear();
    backend = new TauriBackend();
  });

  it("lists a deck's registered reporters", async () => {
    await backend.listReporters("deck-1");
    expect(invoke).toHaveBeenCalledWith("list_reporters", { deckId: "deck-1" });
  });

  it("adds and updates through distinct commands, passing the whole config", async () => {
    await backend.addReporter("deck-1", config);
    expect(invoke).toHaveBeenCalledWith("add_reporter", {
      deckId: "deck-1",
      config,
    });

    await backend.updateReporter("deck-1", config);
    expect(invoke).toHaveBeenCalledWith("update_reporter", {
      deckId: "deck-1",
      config,
    });
  });

  it("removes by id within a deck", async () => {
    await backend.removeReporter("deck-1", "rep-1");
    expect(invoke).toHaveBeenCalledWith("remove_reporter", {
      deckId: "deck-1",
      reporterId: "rep-1",
    });
  });

  it("starts within a deck but stops by id alone (a running child spans decks)", async () => {
    await backend.startReporter("deck-1", "rep-1");
    expect(invoke).toHaveBeenCalledWith("start_reporter", {
      deckId: "deck-1",
      reporterId: "rep-1",
    });

    await backend.stopReporter("rep-1");
    expect(invoke).toHaveBeenCalledWith("stop_reporter", {
      reporterId: "rep-1",
    });
  });

  it("lists running reporters across all decks", async () => {
    await backend.listRunningReporters();
    expect(invoke).toHaveBeenCalledWith("list_running_reporters");
  });
});
