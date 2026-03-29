import { describe, it, expect } from "vitest";
import { COMMANDS, filterCommands } from "./commands";

describe("COMMANDS", () => {
  it("should have unique ids", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should have unique actions", () => {
    const actions = COMMANDS.map((c) => c.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("filterCommands", () => {
  it("should return all commands for empty query", () => {
    expect(filterCommands("")).toEqual(COMMANDS);
    expect(filterCommands("  ")).toEqual(COMMANDS);
  });

  it("should filter by substring (case-insensitive)", () => {
    const results = filterCommands("deck");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.label.toLowerCase().includes("deck"))).toBe(true);
  });

  it("should match partial words", () => {
    const results = filterCommands("col");
    expect(results.some((c) => c.label === "New Column")).toBe(true);
    expect(results.some((c) => c.label === "Delete Column")).toBe(true);
  });

  it("should return empty array for no matches", () => {
    expect(filterCommands("zzzzz")).toEqual([]);
  });
});
