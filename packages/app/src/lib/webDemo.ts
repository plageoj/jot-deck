/**
 * Web demo build flag (docs/009-web-demo.md).
 *
 * Only the demo-specific UI — the banner and the "Web demo" labels — keys off
 * this flag. Everything else that differs in a browser is gated on `isTauri()`
 * so it carries over unchanged to the Web version.
 */
export function isWebDemo(): boolean {
  return import.meta.env.VITE_JOT_DECK_DEMO === "1";
}

/** Where browser-only UI sends people for the desktop app. */
export const DESKTOP_DOWNLOAD_URL = "https://jot-deck.com/#download";
