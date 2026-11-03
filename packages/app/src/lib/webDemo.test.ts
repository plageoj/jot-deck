import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebDemo } from "./webDemo";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isWebDemo", () => {
  it("is off without the build flag", () => {
    vi.stubEnv("VITE_JOT_DECK_DEMO", "");
    expect(isWebDemo()).toBe(false);
  });

  it("is on when the demo build sets the flag", () => {
    vi.stubEnv("VITE_JOT_DECK_DEMO", "1");
    expect(isWebDemo()).toBe(true);
  });
});
