import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, it, expect, vi } from "vitest";
import UpdateBanner from "./UpdateBanner.svelte";
import { updaterStore } from "#lib/updater.svelte.ts";

afterEach(() => {
  // updaterStore is a shared singleton — reset it between cases.
  updaterStore.status = { kind: "idle" };
  vi.restoreAllMocks();
});

describe("UpdateBanner", () => {
  it("stays hidden when an update check fails", () => {
    updaterStore.status = { kind: "error", phase: "check", message: "offline" };
    render(UpdateBanner);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it("shows an install failure", () => {
    updaterStore.status = { kind: "error", phase: "install", message: "disk full" };
    render(UpdateBanner);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("disk full")).toBeTruthy();
  });

  it("shows an available update", () => {
    updaterStore.status = {
      kind: "available",
      info: { version: "1.2.0", currentVersion: "1.1.0" },
    };
    render(UpdateBanner);
    expect(screen.getByRole("button", { name: "Install & restart" })).toBeTruthy();
  });

  it("starts the install from Install & restart", async () => {
    updaterStore.status = { kind: "available", info: { version: "1.2.0", currentVersion: "1.1.0" } };
    const install = vi.spyOn(updaterStore, "installAndRelaunch").mockResolvedValue();
    render(UpdateBanner);
    await fireEvent.click(screen.getByRole("button", { name: "Install & restart" }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Later", { kind: "available", info: { version: "1.2.0", currentVersion: "1.1.0" } }],
    ["Dismiss", { kind: "error", phase: "install", message: "disk full" }],
  ] as const)("%s dismisses the banner", async (label, status) => {
    updaterStore.status = status;
    const dismiss = vi.spyOn(updaterStore, "dismiss");
    render(UpdateBanner);
    await fireEvent.click(screen.getByText(label));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("shows download progress with and without a known size", async () => {
    updaterStore.status = { kind: "downloading", downloaded: 512, contentLength: 3 * 1024 * 1024 };
    const { rerender } = render(UpdateBanner);
    expect(screen.getByText("512 B / 3.0 MB")).toBeTruthy();

    updaterStore.status = { kind: "downloading", downloaded: 2048 };
    await rerender({});
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("shows the installing state without actions", () => {
    updaterStore.status = { kind: "installing" };
    render(UpdateBanner);
    expect(screen.getByText(/Installing update/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
