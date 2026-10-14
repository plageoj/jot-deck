import { describe, it, expect } from "vitest";
import { CursorMemory } from "./cursorMemory";

describe("CursorMemory", () => {
  it("returns the entry unchanged when nothing is remembered", () => {
    expect(new CursorMemory().resolve("card-1", "start", "hello")).toBe("start");
  });

  it("restores the remembered offset while the content is unchanged", () => {
    const memory = new CursorMemory();
    memory.remember("card-1", 3, "hello");
    expect(memory.resolve("card-1", "start", "hello")).toBe(3);
  });

  it("falls back to the start once the content has changed", () => {
    const memory = new CursorMemory();
    memory.remember("card-1", 3, "hello");
    expect(memory.resolve("card-1", "start", "hello world")).toBe("start");
  });

  it("leaves `end` entries alone", () => {
    const memory = new CursorMemory();
    memory.remember("card-1", 3, "hello");
    expect(memory.resolve("card-1", "end", "hello")).toBe("end");
  });

  it("keeps positions per card", () => {
    const memory = new CursorMemory();
    memory.remember("card-1", 3, "hello");
    expect(memory.resolve("card-2", "start", "hello")).toBe("start");
  });
});
