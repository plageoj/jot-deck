import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import DemoBanner from "./DemoBanner.svelte";

describe("DemoBanner", () => {
  it("says nothing is saved and links to the desktop download", () => {
    render(DemoBanner);
    expect(screen.getByText("Web demo — nothing is saved.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Download the desktop app" });
    expect(link.getAttribute("href")).toBe("https://jot-deck.com/#download");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
