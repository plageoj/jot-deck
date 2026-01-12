/**
 * Database Module
 *
 * Provides a unified interface for database operations,
 * automatically selecting the appropriate backend:
 * - Tauri backend for desktop app
 * - WASM SQLite backend for web/testing
 */

import type { DatabaseBackend } from "./types";
export type { DatabaseBackend, CreateDeckParams, CreateColumnParams, CreateCardParams } from "./types";

let backend: DatabaseBackend | null = null;
let initPromise: Promise<DatabaseBackend> | null = null;

/**
 * Check if running inside Tauri
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Get the database backend
 *
 * Automatically detects environment and returns the appropriate backend:
 * - TauriBackend when running in Tauri desktop app
 * - WasmBackend when running in browser (for testing/web)
 */
export async function getDatabase(): Promise<DatabaseBackend> {
  if (backend) return backend;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (isTauri()) {
      console.log("[db] Using Tauri backend");
      const { TauriBackend } = await import("./tauri-backend");
      backend = new TauriBackend();
    } else {
      console.log("[db] Using WASM SQLite backend");
      const { WasmBackend } = await import("./wasm-backend");
      const wasmBackend = new WasmBackend();
      await wasmBackend.init();
      backend = wasmBackend;
    }
    return backend;
  })();

  return initPromise;
}

/**
 * Reset the database (for testing)
 */
export function resetDatabase(): void {
  backend = null;
  initPromise = null;
}
