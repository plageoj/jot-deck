import { parseInlineMarkdown, type MarkdownSegment } from "#lib/markdown.ts";

/** Link hints are labelled with at most two digits, so up to 99 are offered. */
export const MAX_LINK_HINTS = 99;

/** A link found in a card. `label` is its display text, or `null` when the
 * text is just the URL itself (a bare URL). */
export interface CardLink {
  url: string;
  label: string | null;
}

/** Link hint mode state: the card's numbered links and the digits typed so far. */
export interface LinkHints {
  cardId: string;
  links: CardLink[];
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

function textOf(segments: MarkdownSegment[]): string {
  return segments
    .map((segment) => ("children" in segment ? textOf(segment.children) : segment.text))
    .join("");
}

/** The display text of a link, or `null` when it only repeats the URL
 * (bare URLs, including `www.` autolinks that gain an `http://` prefix). */
function linkLabel(url: string, children: MarkdownSegment[]): string | null {
  const label = textOf(children).trim();
  if (!label || url === label || url.replace(/^https?:\/\//i, "") === label) return null;
  return label;
}

/**
 * The http(s) links in a card, in reading order with duplicate URLs dropped
 * (the first occurrence's label wins). Covers `[label](url)` links and bare
 * URLs alike, and is independent of the "Render Markdown" setting so
 * plain-text cards can open their links too.
 */
export function extractLinks(content: string): CardLink[] {
  const links: CardLink[] = [];
  const visit = (segments: MarkdownSegment[]) => {
    for (const segment of segments) {
      if (segment.kind === "link") {
        if (!links.some((link) => link.url === segment.href)) {
          links.push({ url: segment.href, label: linkLabel(segment.href, segment.children) });
        }
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
