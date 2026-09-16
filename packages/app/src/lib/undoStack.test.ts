import { describe, it, expect, vi } from "vitest";
import { UndoStack } from "./undoStack";

function makeEntry() {
  return { undo: vi.fn(async () => {}), redo: vi.fn(async () => {}) };
}

describe("UndoStack", () => {
  it("starts empty", () => {
    const stack = new UndoStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it("undo calls the entry's undo effect and moves it to the redo stack", async () => {
    const stack = new UndoStack();
    const entry = makeEntry();
    stack.push(entry);

    const ok = await stack.undo();

    expect(ok).toBe(true);
    expect(entry.undo).toHaveBeenCalledOnce();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);
  });

  it("redo calls the entry's redo effect and moves it back to the undo stack", async () => {
    const stack = new UndoStack();
    const entry = makeEntry();
    stack.push(entry);
    await stack.undo();

    const ok = await stack.redo();

    expect(ok).toBe(true);
    expect(entry.redo).toHaveBeenCalledOnce();
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it("undo/redo on an empty stack is a no-op returning false", async () => {
    const stack = new UndoStack();
    expect(await stack.undo()).toBe(false);
    expect(await stack.redo()).toBe(false);
  });

  it("pops entries newest-first", async () => {
    const stack = new UndoStack();
    const first = makeEntry();
    const second = makeEntry();
    stack.push(first);
    stack.push(second);

    await stack.undo();
    expect(second.undo).toHaveBeenCalledOnce();
    expect(first.undo).not.toHaveBeenCalled();

    await stack.undo();
    expect(first.undo).toHaveBeenCalledOnce();
  });

  it("pushing a new entry clears the redo stack", async () => {
    const stack = new UndoStack();
    const first = makeEntry();
    stack.push(first);
    await stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.push(makeEntry());

    expect(stack.canRedo).toBe(false);
    expect(await stack.redo()).toBe(false);
  });

  it("clear drops both stacks", async () => {
    const stack = new UndoStack();
    stack.push(makeEntry());
    await stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.clear();

    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it("bounds depth by dropping the oldest entry", async () => {
    const stack = new UndoStack();
    const entries = Array.from({ length: 101 }, () => makeEntry());
    for (const entry of entries) stack.push(entry);

    // The 101st push should have evicted entries[0] — undoing everything
    // must never reach it.
    for (let i = 0; i < 100; i++) {
      expect(await stack.undo()).toBe(true);
    }
    expect(await stack.undo()).toBe(false);
    expect(entries[0].undo).not.toHaveBeenCalled();
    expect(entries[1].undo).toHaveBeenCalledOnce();
  });
});
