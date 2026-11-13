import { render, screen } from "@testing-library/svelte";
import { afterEach, describe, it, expect } from "vitest";
import UpdateBanner from "./UpdateBanner.svelte";
import { updaterStore } from "#lib/updater.svelte.ts";

afterEach(() => {
  // updaterStore is a shared singleton — reset it between cases.
  updaterStore.status = { kind: "idle" };
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
});
