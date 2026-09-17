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

  it("a rejected undo restores the entry to the past stack instead of dropping it", async () => {
    const stack = new UndoStack();
    const entry = {
      undo: vi.fn(async () => {
        throw new Error("boom");
      }),
      redo: vi.fn(async () => {}),
    };
    stack.push(entry);

    await expect(stack.undo()).rejects.toThrow("boom");

    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it("a rejected redo restores the entry to the future stack instead of dropping it", async () => {
    const stack = new UndoStack();
    const entry = {
      undo: vi.fn(async () => {}),
      redo: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    stack.push(entry);
    await stack.undo();

    await expect(stack.redo()).rejects.toThrow("boom");

    expect(stack.canRedo).toBe(true);
    expect(stack.canUndo).toBe(false);
  });

  it("a second undo call while one is in flight is a no-op", async () => {
    const stack = new UndoStack();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Pushed in order [buried, top] — undo() pops LIFO, so `top` is the one
    // gated in flight and `buried` must stay untouched until it resolves.
    const buried = makeEntry();
    const top = { undo: vi.fn(async () => gate), redo: vi.fn(async () => {}) };
    stack.push(buried);
    stack.push(top);

    const topUndo = stack.undo();
    const reentrant = await stack.undo();

    expect(reentrant).toBe(false);
    expect(buried.undo).not.toHaveBeenCalled();

    release();
    expect(await topUndo).toBe(true);
    expect(top.undo).toHaveBeenCalledOnce();
  });

  it("push and pop after clear() during an in-flight undo do not repopulate the old generation", async () => {
    const stack = new UndoStack();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entry = { undo: vi.fn(async () => gate), redo: vi.fn(async () => {}) };
    stack.push(entry);

    const undoPromise = stack.undo();
    stack.clear(); // simulates a deck switch while the effect is still awaiting
    release();
    await undoPromise;

    // The completed entry belongs to the old generation and must not land in
    // the new (post-clear) redo stack.
    expect(stack.canRedo).toBe(false);
    expect(stack.canUndo).toBe(false);
  });

  it("push is skipped when the passed generation no longer matches (stale mutation)", () => {
    const stack = new UndoStack();
    const generation = stack.currentGeneration;
    stack.clear();

    stack.push(makeEntry(), generation);

    expect(stack.canUndo).toBe(false);
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
