/**
 * Delete stack management for undo functionality.
 * This module provides a reactive delete stack that can be used
 * to track deleted items and restore them.
 */

export interface DeletedItem {
  type: "card" | "column";
  id: string;
}

/**
 * Creates a delete stack manager with reactive state updates.
 * The callbacks allow integration with Svelte's reactivity system.
 */
export function createDeleteStack(options: {
  onRestore: (item: DeletedItem) => Promise<void>;
  onError?: (error: string) => void;
}) {
  let stack: DeletedItem[] = [];

  return {
    /**
     * Get the current stack (for debugging/display)
     */
    getStack(): readonly DeletedItem[] {
      return stack;
    },

    /**
     * Get the current stack length
     */
    get length(): number {
      return stack.length;
    },

    /**
     * Check if the stack is empty
     */
    isEmpty(): boolean {
      return stack.length === 0;
    },

    /**
     * Push a deleted item onto the stack (immutable update)
     */
    push(item: DeletedItem): DeletedItem[] {
      stack = [...stack, item];
      return stack;
    },

    /**
     * Pop and restore the last deleted item
     */
    async popAndRestore(): Promise<boolean> {
      if (stack.length === 0) {
        return false;
      }

      const item = stack[stack.length - 1];
      try {
        await options.onRestore(item);
        // Success - remove from stack
        stack = stack.slice(0, -1);
        return true;
      } catch (e) {
        options.onError?.(`Failed to undo: ${e}`);
        return false;
      }
    },

    /**
     * Clear the stack
     */
    clear(): void {
      stack = [];
    },

    /**
     * Restore a specific item by id (for trash UI)
     */
    async restoreById(id: string): Promise<boolean> {
      const index = stack.findIndex((item) => item.id === id);
      if (index === -1) {
        return false;
      }

      const item = stack[index];
      try {
        await options.onRestore(item);
        // Success - remove from stack
        stack = [...stack.slice(0, index), ...stack.slice(index + 1)];
        return true;
      } catch (e) {
        options.onError?.(`Failed to restore: ${e}`);
        return false;
      }
    },
  };
}

export type DeleteStack = ReturnType<typeof createDeleteStack>;
