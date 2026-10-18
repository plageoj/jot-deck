import { parseInlineMarkdown, type MarkdownSegment } from "#lib/markdown.ts";

/** Link hints are labelled with at most two digits, so up to 99 are offered. */
export const MAX_LINK_HINTS = 99;

/** Link hint mode state: the card's numbered links and the digits typed so far. */
export interface LinkHints {
  cardId: string;
  links: string[];
  typed: string;
}

/**
 * Hint labels for `count` links: `1`–`9` up to nine links, otherwise every
 * label is padded to two digits (`01`–`99`). Equal-width labels mean no label
 * is a prefix of another, so a label opens as soon as it is fully typed.
 */
export function linkHintLabels(count: number): string[] {
  const width = count >= 10 ? 2 : 1;
  return Array.from({ length: count }, (_, i) => String(i + 1).padStart(width, "0"));
}

/**
 * The http(s) URLs in a card, in reading order with duplicates dropped.
 * Covers `[label](url)` links and bare URLs alike, and is independent of the
 * "Render Markdown" setting so plain-text cards can open their links too.
 */
export function extractLinks(content: string): string[] {
  const links: string[] = [];
  const visit = (segments: MarkdownSegment[]) => {
    for (const segment of segments) {
      if (segment.kind === "link") {
        if (!links.includes(segment.href)) links.push(segment.href);
      } else if (segment.kind === "bold" || segment.kind === "italic") {
        visit(segment.children);
      }
    }
  };
  visit(parseInlineMarkdown(content));
  return links;
}

/**
 * Open a URL in the system browser. In the Tauri shell this goes through the
 * opener plugin so the webview itself never navigates away; the web build
 * falls back to a new tab.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in globalThis) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
