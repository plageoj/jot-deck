import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createDeleteStack, type DeletedItem } from "./deleteStack";

describe("createDeleteStack", () => {
  let mockRestore: Mock<(item: DeletedItem) => Promise<void>>;
  let mockError: Mock<(error: string) => void>;
  let stack: ReturnType<typeof createDeleteStack>;

  beforeEach(() => {
    mockRestore = vi.fn<(item: DeletedItem) => Promise<void>>().mockResolvedValue(undefined);
    mockError = vi.fn<(error: string) => void>();
    stack = createDeleteStack({
      onRestore: mockRestore,
      onError: mockError,
    });
  });

  describe("push", () => {
    it("should add item to stack", () => {
      const item: DeletedItem = { type: "card", id: "card-1" };
      const result = stack.push(item);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(item);
      expect(stack.length).toBe(1);
    });

    it("should maintain LIFO order", () => {
      stack.push({ type: "card", id: "card-1" });
      stack.push({ type: "column", id: "col-1" });
      stack.push({ type: "card", id: "card-2" });

      const items = stack.getStack();
      expect(items).toHaveLength(3);
      expect(items[0].id).toBe("card-1");
      expect(items[1].id).toBe("col-1");
      expect(items[2].id).toBe("card-2");
    });

    it("should return new array reference (immutable)", () => {
      const result1 = stack.push({ type: "card", id: "card-1" });
      const result2 = stack.push({ type: "card", id: "card-2" });

      expect(result1).not.toBe(result2);
    });
  });

  describe("popAndRestore", () => {
    it("should restore last item and remove from stack", async () => {
      stack.push({ type: "card", id: "card-1" });
      stack.push({ type: "card", id: "card-2" });

      const result = await stack.popAndRestore();

      expect(result).toBe(true);
      expect(mockRestore).toHaveBeenCalledWith({ type: "card", id: "card-2" });
      expect(stack.length).toBe(1);
      expect(stack.getStack()[0].id).toBe("card-1");
    });

    it("should return false for empty stack", async () => {
      const result = await stack.popAndRestore();

      expect(result).toBe(false);
      expect(mockRestore).not.toHaveBeenCalled();
    });

    it("should call onError and keep item on failure", async () => {
      mockRestore.mockRejectedValueOnce(new Error("DB error"));
      stack.push({ type: "card", id: "card-1" });

      const result = await stack.popAndRestore();

      expect(result).toBe(false);
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining("Failed to undo")
      );
      expect(stack.length).toBe(1); // Item should still be in stack
    });
  });

  describe("isEmpty", () => {
    it("should return true for empty stack", () => {
      expect(stack.isEmpty()).toBe(true);
    });

    it("should return false for non-empty stack", () => {
      stack.push({ type: "card", id: "card-1" });
      expect(stack.isEmpty()).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all items", () => {
      stack.push({ type: "card", id: "card-1" });
      stack.push({ type: "card", id: "card-2" });

      stack.clear();

      expect(stack.length).toBe(0);
      expect(stack.isEmpty()).toBe(true);
    });
  });

  describe("restoreById", () => {
    it("should restore specific item by id", async () => {
      stack.push({ type: "card", id: "card-1" });
      stack.push({ type: "column", id: "col-1" });
      stack.push({ type: "card", id: "card-2" });

      const result = await stack.restoreById("col-1");

      expect(result).toBe(true);
      expect(mockRestore).toHaveBeenCalledWith({ type: "column", id: "col-1" });
      expect(stack.length).toBe(2);
      expect(stack.getStack().map((i) => i.id)).toEqual(["card-1", "card-2"]);
    });

    it("should return false for non-existent id", async () => {
      stack.push({ type: "card", id: "card-1" });

      const result = await stack.restoreById("non-existent");

      expect(result).toBe(false);
      expect(mockRestore).not.toHaveBeenCalled();
    });
  });

  describe("yy -> p -> dd -> u flow", () => {
    it("should correctly undo a pasted then deleted card", async () => {
      // Simulate: copy existing card, paste creates new card with new ID,
      // delete the pasted card, then undo

      // 1. User copies card (yy) - no stack change, just clipboard
      // 2. User pastes (p) - creates new card with ID "new-card-id"
      //    (In real app, this comes from backend after create_card)
      const pastedCardId = "new-card-id";

      // 3. User deletes the pasted card (dd)
      stack.push({ type: "card", id: pastedCardId });
      expect(stack.length).toBe(1);
      expect(stack.getStack()[0].id).toBe(pastedCardId);

      // 4. User undoes (u)
      const result = await stack.popAndRestore();

      expect(result).toBe(true);
      expect(mockRestore).toHaveBeenCalledWith({
        type: "card",
        id: pastedCardId,
      });
      expect(stack.length).toBe(0);
    });

    it("should handle multiple delete-undo cycles", async () => {
      // Delete card 1
      stack.push({ type: "card", id: "card-1" });
      expect(stack.length).toBe(1);

      // Delete card 2
      stack.push({ type: "card", id: "card-2" });
      expect(stack.length).toBe(2);

      // Undo (restores card 2)
      await stack.popAndRestore();
      expect(stack.length).toBe(1);
      expect(mockRestore).toHaveBeenLastCalledWith({
        type: "card",
        id: "card-2",
      });

      // Delete card 3
      stack.push({ type: "card", id: "card-3" });
      expect(stack.length).toBe(2);

      // Undo (restores card 3)
      await stack.popAndRestore();
      expect(stack.length).toBe(1);
      expect(mockRestore).toHaveBeenLastCalledWith({
        type: "card",
        id: "card-3",
      });

      // Undo (restores card 1)
      await stack.popAndRestore();
      expect(stack.length).toBe(0);
      expect(mockRestore).toHaveBeenLastCalledWith({
        type: "card",
        id: "card-1",
      });
    });
  });
});
