import { TAG_PATTERN } from "./types";

/**
 * Inline-only markdown segments produced for view-mode rendering.
 *
 * The renderer intentionally targets the small surface used inside cards
 * (typically <= 140 chars): `**bold**`, `*italic*` / `_italic_`, `` `code` ``,
 * `[label](url)`, plus `#tag` hash-tags emitted with the same shape that
 * `TagHighlight` uses so it can be embedded inside the markdown flow.
 */
export type MarkdownSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "tag"; text: string; tagName: string };

interface Token {
  pattern: RegExp;
  build(match: RegExpExecArray): MarkdownSegment;
}

const TOKENS: Token[] = [
  {
    pattern: /\*\*([^*]+)\*\*/g,
    build: (m) => ({ kind: "bold", text: m[1] }),
  },
  {
    pattern: /__([^_]+)__/g,
    build: (m) => ({ kind: "bold", text: m[1] }),
  },
  {
    pattern: /\*([^*\s][^*]*)\*/g,
    build: (m) => ({ kind: "italic", text: m[1] }),
  },
  {
    pattern: /(?<![A-Za-z0-9_])_([^_\s][^_]*)_(?![A-Za-z0-9_])/g,
    build: (m) => ({ kind: "italic", text: m[1] }),
  },
  {
    pattern: /`([^`]+)`/g,
    build: (m) => ({ kind: "code", text: m[1] }),
  },
  {
    pattern: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    build: (m) => ({ kind: "link", text: m[1], href: m[2] }),
  },
  {
    pattern: new RegExp(TAG_PATTERN, "g"),
    build: (m) => ({ kind: "tag", text: m[0], tagName: m[1] }),
  },
];

interface RankedMatch {
  start: number;
  end: number;
  segment: MarkdownSegment;
}

function findEarliestMatch(
  content: string,
  fromIndex: number,
): RankedMatch | null {
  let earliest: RankedMatch | null = null;
  for (const token of TOKENS) {
    token.pattern.lastIndex = fromIndex;
    const match = token.pattern.exec(content);
    if (!match) continue;
    if (!earliest || match.index < earliest.start) {
      earliest = {
        start: match.index,
        end: match.index + match[0].length,
        segment: token.build(match),
      };
    }
  }
  return earliest;
}

export function parseInlineMarkdown(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const next = findEarliestMatch(content, cursor);
    if (!next) {
      segments.push({ kind: "text", text: content.slice(cursor) });
      break;
    }
    if (next.start > cursor) {
      segments.push({
        kind: "text",
        text: content.slice(cursor, next.start),
      });
    }
    segments.push(next.segment);
    cursor = next.end;
  }

  return segments;
}
