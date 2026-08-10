import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import ReportersDialog from "./ReportersDialog.svelte";
import type { ReporterConfig } from "$lib/types";

// jsdom's <dialog> support varies; stub the modal methods so onMount's
// showModal() and the close button never throw regardless of jsdom version.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

// Toggle the simulated Tauri environment per test (name prefixed `mock` so the
// hoisted vi.mock factory may reference it).
const mockEnv = { tauri: false };
const mockListen = vi.fn(async (_event: string, _handler: unknown) => () => {});

vi.mock("$lib/db", () => ({ isTauri: () => mockEnv.tauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

function makeReporter(
  id: string,
  overrides: Partial<ReporterConfig> = {},
): ReporterConfig {
  return {
    reporter_id: id,
    name: `${id}-name`,
    command: `/usr/local/bin/${id}`,
    args: [],
    env: {},
    deny: [],
    max_writes_per_min: null,
    allowed_columns: null,
    ...overrides,
  };
}

/** Props with every callback stubbed; each test overrides what it exercises. */
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    deckId: "deck-1",
    listReporters: vi.fn(async () => [] as ReporterConfig[]),
    listRunning: vi.fn(async () => [] as string[]),
    onAdd: vi.fn(async (_d: string, c: ReporterConfig) => c),
    onUpdate: vi.fn(async (_d: string, c: ReporterConfig) => c),
    onRemove: vi.fn(async () => {}),
    onStart: vi.fn(async () => {}),
    onStop: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...overrides,
  };
}

/** Render and wait for the initial load to settle. */
async function renderDialog(overrides: Record<string, unknown> = {}) {
  const props = makeProps(overrides);
  render(ReportersDialog, { props });
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return props;
}

/** Open the add/edit form and fill the two required fields. */
async function fillForm(name: string, command: string) {
  await fireEvent.input(screen.getByLabelText("Name"), {
    target: { value: name },
  });
  await fireEvent.input(screen.getByLabelText("Command"), {
    target: { value: command },
  });
}

beforeEach(() => {
  mockEnv.tauri = false;
  // Reset the implementation too, not just the calls: the Tauri case installs a
  // persistent one, which would otherwise leak into later tests.
  mockListen.mockReset();
  mockListen.mockImplementation(async () => () => {});
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ReportersDialog listing", () => {
  it("shows an empty-state hint when the deck has no reporters", async () => {
    const props = await renderDialog();

    expect(
      screen.getByText("No reporters registered for this deck yet."),
    ).toBeTruthy();
    expect(props.listReporters).toHaveBeenCalledWith("deck-1");
  });

  it("lists reporters with a Stopped badge and their command", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
    });

    expect(screen.getByText("r1-name")).toBeTruthy();
    expect(screen.getByText("/usr/local/bin/r1")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("marks reporters reported as running and offers Stop instead of Start", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1"), makeReporter("r2")]),
      listRunning: vi.fn(async () => ["r1"]),
    });

    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("surfaces a load failure instead of an empty list", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => {
        throw new Error("host unavailable");
      }),
    });

    expect(
      screen.getByText(/Failed to load reporters:.*host unavailable/),
    ).toBeTruthy();
    expect(
      screen.queryByText("No reporters registered for this deck yet."),
    ).toBeNull();
  });
});

describe("ReportersDialog start/stop", () => {
  it("start spawns the reporter and flips its badge to Running", async () => {
    const props = await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(props.onStart).toHaveBeenCalledWith("deck-1", "r1");
    expect(await screen.findByText("Running")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("stop tears the reporter down and flips its badge back to Stopped", async () => {
    const props = await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
      listRunning: vi.fn(async () => ["r1"]),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(props.onStop).toHaveBeenCalledWith("r1");
    expect(await screen.findByText("Stopped")).toBeTruthy();
  });

  it("shows a spawn failure on the row and leaves it stopped", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
      onStart: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByText(/ENOENT/)).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    // The row stays actionable so the user can fix the path and retry.
    expect(
      screen.getByRole("button", { name: "Start" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("shows a stop failure on the row and keeps it running", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
      listRunning: vi.fn(async () => ["r1"]),
      onStop: vi.fn(async () => {
        throw new Error("no such process");
      }),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByText(/no such process/)).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("disables the button while a start is in flight", async () => {
    let release: () => void = () => {};
    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
      onStart: vi.fn(
        () => new Promise<void>((resolve) => (release = resolve)),
      ),
    });

    const button = screen.getByRole("button", { name: "Start" });
    await fireEvent.click(button);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start" }).hasAttribute("disabled"),
      ).toBe(true),
    );
    release();
    expect(await screen.findByText("Running")).toBeTruthy();
  });

  it("clears a previous row error when the action is retried", async () => {
    const onStart = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(undefined);
    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
      onStart,
    });

    await fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/ENOENT/)).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByText("Running")).toBeTruthy();
    expect(screen.queryByText(/ENOENT/)).toBeNull();
  });
});

describe("ReportersDialog removal", () => {
  it("asks for confirmation before removing", async () => {
    const props = await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByText("Remove?")).toBeTruthy();
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it("cancel backs out and restores the row actions", async () => {
    const props = await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Remove?")).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it("confirming removes the registration and reloads the list", async () => {
    const listReporters = vi
      .fn<() => Promise<ReporterConfig[]>>()
      .mockResolvedValueOnce([makeReporter("r1")])
      .mockResolvedValue([]);
    const props = await renderDialog({ listReporters });

    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(props.onRemove).toHaveBeenCalledWith("deck-1", "r1");
    expect(
      await screen.findByText("No reporters registered for this deck yet."),
    ).toBeTruthy();
  });

  it("keeps the row and reports the failure when removal fails", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
      onRemove: vi.fn(async () => {
        throw new Error("registry locked");
      }),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(/registry locked/)).toBeTruthy();
    // Confirmation is dismissed, the reporter is still listed.
    expect(screen.queryByText("Remove?")).toBeNull();
    expect(screen.getByText("r1-name")).toBeTruthy();
  });
});

describe("ReportersDialog add/edit form", () => {
  it("requires a name", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Name is required.")).toBeTruthy();
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("requires a command", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));
    await fireEvent.input(screen.getByLabelText("Name"), {
      target: { value: "Minutes" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      screen.getByText("Command (absolute path to the binary) is required."),
    ).toBeTruthy();
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("adds a reporter, parsing args per line and env as KEY=VALUE", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));
    await fillForm("  Minutes  ", "  /opt/whisper  ");
    await fireEvent.input(screen.getByLabelText("Arguments"), {
      target: { value: "--model\n  small  \n\n--lang=ja" },
    });
    await fireEvent.input(screen.getByLabelText("Environment"), {
      target: { value: "TOKEN=abc123\n\nURL=https://x/y=z" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(props.onAdd).toHaveBeenCalledWith("deck-1", {
      reporter_id: "",
      name: "Minutes",
      command: "/opt/whisper",
      args: ["--model", "small", "--lang=ja"],
      // Only the first `=` splits, so values may contain `=`.
      env: { TOKEN: "abc123", URL: "https://x/y=z" },
      deny: [],
      max_writes_per_min: null,
      allowed_columns: null,
    });
    // The form closes once the registration lands.
    expect(
      await screen.findByRole("button", { name: "+ Add reporter" }),
    ).toBeTruthy();
  });

  it("rejects an env line without KEY=VALUE", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));
    await fillForm("Minutes", "/opt/whisper");
    await fireEvent.input(screen.getByLabelText("Environment"), {
      target: { value: "JUST_A_KEY" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      screen.getByText(/Invalid env line \(expected KEY=VALUE\): JUST_A_KEY/),
    ).toBeTruthy();
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("rejects an env line with an empty key", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));
    await fillForm("Minutes", "/opt/whisper");
    await fireEvent.input(screen.getByLabelText("Environment"), {
      target: { value: "=orphan" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText(/Invalid env line/)).toBeTruthy();
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("keeps the form open and reports a failed save", async () => {
    await renderDialog({
      onAdd: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));
    await fillForm("Minutes", "/opt/whisper");
    await fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText(/Failed to save reporter:.*disk full/),
    ).toBeTruthy();
    // Still editable, so the draft isn't lost.
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });

  it("edit prefills the form from the existing registration", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => [
        makeReporter("r1", {
          name: "Minutes",
          command: "/opt/whisper",
          args: ["--model", "small"],
          env: { TOKEN: "abc" },
        }),
      ]),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("heading", { name: "Edit reporter" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Minutes",
    );
    expect((screen.getByLabelText("Command") as HTMLInputElement).value).toBe(
      "/opt/whisper",
    );
    expect(
      (screen.getByLabelText("Arguments") as HTMLTextAreaElement).value,
    ).toBe("--model\nsmall");
    expect(
      (screen.getByLabelText("Environment") as HTMLTextAreaElement).value,
    ).toBe("TOKEN=abc");
  });

  it("saving an edit updates in place and preserves the auth scope fields", async () => {
    const props = await renderDialog({
      listReporters: vi.fn(async () => [
        makeReporter("r1", {
          name: "Minutes",
          command: "/opt/whisper",
          deny: ["delete"],
          max_writes_per_min: 30,
          allowed_columns: ["col-1"],
        }),
      ]),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await fireEvent.input(screen.getByLabelText("Name"), {
      target: { value: "Minutes v2" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(props.onUpdate).toHaveBeenCalledWith("deck-1", {
      reporter_id: "r1",
      name: "Minutes v2",
      command: "/opt/whisper",
      args: [],
      env: {},
      // Not editable in this UI yet — carried through untouched (007 §10).
      deny: ["delete"],
      max_writes_per_min: 30,
      allowed_columns: ["col-1"],
    });
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("cancel closes the form without saving", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));
    await fillForm("Minutes", "/opt/whisper");
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "+ Add reporter" })).toBeTruthy();
  });

  it("add after an edit starts from a blank draft", async () => {
    await renderDialog({
      listReporters: vi.fn(async () => [
        makeReporter("r1", { name: "Minutes", command: "/opt/whisper" }),
      ]),
    });

    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await fireEvent.click(screen.getByRole("button", { name: "+ Add reporter" }));

    expect(screen.getByRole("heading", { name: "Add reporter" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Command") as HTMLInputElement).value).toBe("");
  });
});

describe("ReportersDialog dialog shell", () => {
  it("keeps keystrokes from reaching the board's global handler", async () => {
    await renderDialog();
    const onDocumentKeydown = vi.fn();
    document.addEventListener("keydown", onDocumentKeydown);

    await fireEvent.keyDown(screen.getByRole("dialog"), { key: "j" });

    expect(onDocumentKeydown).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDocumentKeydown);
  });

  it("the close button closes the dialog and notifies the caller", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("button", { name: "Close reporters" }));

    expect(props.onClose).toHaveBeenCalled();
  });

  it("a click on the backdrop closes, a click inside does not", async () => {
    const props = await renderDialog();

    await fireEvent.click(screen.getByRole("heading", { name: "Reporters" }));
    expect(props.onClose).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("dialog"));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("ReportersDialog under Tauri", () => {
  it("drops the Running badge when the child process exits on its own", async () => {
    mockEnv.tauri = true;
    let emitExit: ((e: { payload: { reporter_id: string } }) => void) | undefined;
    mockListen.mockImplementation(async (_event: string, handler: unknown) => {
      emitExit = handler as (e: { payload: { reporter_id: string } }) => void;
      return () => {};
    });

    await renderDialog({
      listReporters: vi.fn(async () => [makeReporter("r1")]),
      listRunning: vi.fn(async () => ["r1"]),
    });
    await waitFor(() => expect(emitExit).toBeDefined());

    expect(screen.getByText("Running")).toBeTruthy();
    emitExit?.({ payload: { reporter_id: "r1" } });

    expect(await screen.findByText("Stopped")).toBeTruthy();
  });

  it("does not subscribe to reporter-exit outside Tauri", async () => {
    await renderDialog();
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("drops a subscription that resolves after the dialog is closed", async () => {
    mockEnv.tauri = true;
    const unlisten = vi.fn();
    let resolveListen: (fn: () => void) => void = () => {};
    mockListen.mockImplementation(
      () => new Promise<() => void>((resolve) => (resolveListen = resolve)),
    );

    const { unmount } = render(ReportersDialog, { props: makeProps() });
    await waitFor(() => expect(mockListen).toHaveBeenCalled());
    // Close while listen() is still pending, then let it settle.
    unmount();
    resolveListen(unlisten);

    // Nothing is left listening for a component that is already gone.
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
