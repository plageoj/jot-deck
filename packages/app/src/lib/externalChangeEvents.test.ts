import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsTauri, mockListen } = vi.hoisted(() => ({
  mockIsTauri: vi.fn(() => true),
  mockListen: vi.fn(),
}));

vi.mock("#lib/db/index.ts", () => ({
  isTauri: mockIsTauri,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

import { ExternalChangeEvents } from "./externalChangeEvents";

describe("ExternalChangeEvents lifecycle", () => {
  beforeEach(() => {
    mockIsTauri.mockReturnValue(true);
    mockListen.mockReset();
  });

  it("unregisters earlier listeners when a later registration fails", async () => {
    const firstUnlisten = vi.fn();
    mockListen
      .mockResolvedValueOnce(firstUnlisten)
      .mockRejectedValueOnce(new Error("registration failed"));
    const events = new ExternalChangeEvents({
      onExternalChange: vi.fn(),
      onReporterStream: vi.fn(),
    });

    await expect(events.start()).rejects.toThrow("registration failed");

    expect(firstUnlisten).toHaveBeenCalledOnce();
    expect(mockListen).toHaveBeenCalledTimes(2);
  });

  it("unregisters a listener that resolves after stop invalidates startup", async () => {
    const firstUnlisten = vi.fn();
    const lateUnlisten = vi.fn();
    let resolveSecond!: (unlisten: () => void) => void;
    mockListen
      .mockResolvedValueOnce(firstUnlisten)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const onExternalChange = vi.fn();
    const events = new ExternalChangeEvents({
      onExternalChange,
      onReporterStream: vi.fn(),
    });

    const startup = events.start();
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalledTimes(2));
    events.stop();
    expect(firstUnlisten).toHaveBeenCalledOnce();

    resolveSecond(lateUnlisten);
    await startup;

    expect(lateUnlisten).toHaveBeenCalledOnce();
    expect(mockListen).toHaveBeenCalledTimes(2);
    expect(onExternalChange).not.toHaveBeenCalled();
  });
});
