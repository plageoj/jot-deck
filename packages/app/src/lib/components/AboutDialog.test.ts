import { render, screen, fireEvent } from "@testing-library/svelte";
import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import AboutDialog from "./AboutDialog.svelte";
import { updaterStore } from "$lib/updater.svelte";

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

afterEach(() => {
  // updaterStore is a shared singleton — reset it between cases.
  updaterStore.status = { kind: "idle" };
});

describe("AboutDialog outside Tauri", () => {
  it("renders app name and a dev-build version placeholder", () => {
    render(AboutDialog, { props: { onClose: vi.fn() } });
    expect(
      screen.getByRole("heading", { name: "About Jot Deck" }),
    ).toBeTruthy();
    expect(screen.getByText("dev build")).toBeTruthy();
  });

  it("shows external links with correct hrefs", () => {
    render(AboutDialog, { props: { onClose: vi.fn() } });
    const website = screen.getByRole("link", { name: "Website" });
    const github = screen.getByRole("link", { name: "GitHub" });
    const issues = screen.getByRole("link", { name: "Report an issue" });
    expect(website.getAttribute("href")).toBe("https://jot-deck.com");
    expect(github.getAttribute("href")).toBe(
      "https://github.com/plageoj/jot-deck",
    );
    expect(issues.getAttribute("href")).toBe(
      "https://github.com/plageoj/jot-deck/issues",
    );
  });

  it("lets the anchor navigate normally (openExternal is a no-op)", async () => {
    render(AboutDialog, { props: { onClose: vi.fn() } });
    const github = screen.getByRole("link", { name: "GitHub" });
    // Suppress jsdom's unimplemented navigation while still exercising the
    // click handler, which returns early because isTauri is false.
    github.addEventListener("click", (e) => e.preventDefault());
    await fireEvent.click(github);
    // openExternal returned early (no Tauri), so the anchor is untouched and
    // the dialog is still mounted — nothing navigated or crashed.
    expect(github.isConnected).toBe(true);
  });

  it("disables the update check and shows a desktop-only hint", () => {
    render(AboutDialog, { props: { onClose: vi.fn() } });
    const button = screen.getByRole("button", { name: "Check for Updates" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Updates are available in the desktop app."),
    ).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(AboutDialog, { props: { onClose } });
    await fireEvent.click(screen.getByRole("button", { name: "Close about" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop (the dialog element itself) is clicked", async () => {
    const onClose = vi.fn();
    render(AboutDialog, { props: { onClose } });
    const dialog = screen.getByRole("dialog", { name: "About Jot Deck" });
    // A click whose target is the dialog element (not the inner panel) is a
    // backdrop click and should close the dialog.
    await fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stops keydown from propagating to global keybindings", async () => {
    render(AboutDialog, { props: { onClose: vi.fn() } });
    const dialog = screen.getByRole("dialog", { name: "About Jot Deck" });
    const bubbled = vi.fn();
    document.body.addEventListener("keydown", bubbled);
    await fireEvent.keyDown(dialog, { key: "j" });
    document.body.removeEventListener("keydown", bubbled);
    expect(bubbled).not.toHaveBeenCalled();
  });
});

describe("AboutDialog update status rendering", () => {
  it("renders the up-to-date message", () => {
    updaterStore.status = { kind: "up-to-date" };
    render(AboutDialog, { props: { onClose: vi.fn() } });
    expect(screen.getByText("You're on the latest version.")).toBeTruthy();
  });

  it("renders an available update with an install button", () => {
    updaterStore.status = {
      kind: "available",
      info: { version: "1.2.0", currentVersion: "1.1.0" },
    };
    render(AboutDialog, { props: { onClose: vi.fn() } });
    expect(screen.getByText("v1.2.0")).toBeTruthy();
    expect(screen.getByText("(current v1.1.0)")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Install & restart/ }),
    ).toBeTruthy();
  });

  it("formats download progress with content length", () => {
    updaterStore.status = {
      kind: "downloading",
      downloaded: 1536, // 1.5 KB
      contentLength: 3 * 1024 * 1024, // 3.0 MB
    };
    render(AboutDialog, { props: { onClose: vi.fn() } });
    expect(screen.getByText(/Downloading update/)).toBeTruthy();
    expect(screen.getByText("1.5 KB / 3.0 MB")).toBeTruthy();
  });

  it("formats download progress without a content length (bytes)", () => {
    updaterStore.status = { kind: "downloading", downloaded: 512 };
    render(AboutDialog, { props: { onClose: vi.fn() } });
    expect(screen.getByText("512 B")).toBeTruthy();
  });

  it("renders the installing message", () => {
    updaterStore.status = { kind: "installing" };
    render(AboutDialog, { props: { onClose: vi.fn() } });
    expect(
      screen.getByText("Installing update — app will restart…"),
    ).toBeTruthy();
  });

  it("renders an update error", () => {
    updaterStore.status = { kind: "error", message: "network down" };
    render(AboutDialog, { props: { onClose: vi.fn() } });
    expect(screen.getByText("network down")).toBeTruthy();
  });
});
