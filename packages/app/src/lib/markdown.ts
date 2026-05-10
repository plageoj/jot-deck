import { Lexer, marked, type Tokens, type TokenizerExtension } from "marked";

import { TAG_PATTERN } from "./types";

/**
 * Inline-only markdown segments produced for view-mode rendering.
 *
 * Parsing is delegated to `marked` (CommonMark) for `**bold**`, `*italic*`,
 * `` `code` ``, and `[label](url)`; only `#tag` detection is custom because
 * it isn't part of the CommonMark spec. Bold / italic / link wrappers carry
 * nested children so `#tag` matches inside (`**#urgent**`) still surface as
 * clickable tag segments. Code spans stay opaque on purpose — backticks
 * imply literal content.
 */
export type MarkdownSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: MarkdownSegment[] }
  | { kind: "italic"; children: MarkdownSegment[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MarkdownSegment[] }
  | { kind: "tag"; text: string; tagName: string };

interface HashtagToken {
  type: "hashtag";
  raw: string;
  text: string;
  tagName: string;
}

const TAG_TOKENIZER_REGEX = new RegExp("^" + TAG_PATTERN);

const hashtagExtension: TokenizerExtension = {
  name: "hashtag",
  level: "inline",
  start(src) {
    return src.match(/#/)?.index;
  },
  tokenizer(src) {
    const match = TAG_TOKENIZER_REGEX.exec(src);
    if (!match) return undefined;
    const token: HashtagToken = {
      type: "hashtag",
      raw: match[0],
      text: match[0],
      tagName: match[1],
    };
    return token as unknown as Tokens.Generic;
  },
};

// Register the hashtag extension globally. `marked.use()` modifies a shared
// option set; subsequently constructed Lexers pick up the extension through
// the static defaults.
marked.use({ extensions: [hashtagExtension] });

const lexer = new Lexer();

/** Allow only http(s) URLs; anything else (mailto:, javascript:, …) is dropped. */
function safeHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

function convertTokens(tokens: Tokens.Generic[] | undefined): MarkdownSegment[] {
  if (!tokens) return [];
  const out: MarkdownSegment[] = [];
  for (const token of tokens) {
    const seg = convertToken(token);
    if (seg) out.push(seg);
  }
  return out;
}

function convertToken(token: Tokens.Generic): MarkdownSegment | null {
  switch (token.type) {
    case "text": {
      const t = token as Tokens.Text;
      // Some text tokens carry inline `tokens` (e.g. inside paragraphs); when
      // present, prefer the structured children so nested hashtags surface.
      if (t.tokens && t.tokens.length > 0) {
        // Flatten: text-with-children isn't a wrapper — return its children
        // directly so they sit at the parent level.
        const children = convertTokens(t.tokens);
        return children.length === 1
          ? children[0]
          : { kind: "text", text: collectText(children) };
      }
      return { kind: "text", text: t.text };
    }
    case "escape":
      return { kind: "text", text: (token as Tokens.Escape).text };
    case "strong":
      return {
        kind: "bold",
        children: convertTokens((token as Tokens.Strong).tokens),
      };
    case "em":
      return {
        kind: "italic",
        children: convertTokens((token as Tokens.Em).tokens),
      };
    case "codespan":
      return { kind: "code", text: (token as Tokens.Codespan).text };
    case "link": {
      const link = token as Tokens.Link;
      const href = safeHref(link.href);
      if (!href) {
        // Drop the wrapper but keep the label text as plain children.
        const children = convertTokens(link.tokens);
        if (children.length === 1) return children[0];
        return { kind: "text", text: collectText(children) };
      }
      return {
        kind: "link",
        href,
        children: convertTokens(link.tokens),
      };
    }
    case "hashtag": {
      const tag = token as unknown as HashtagToken;
      return { kind: "tag", text: tag.text, tagName: tag.tagName };
    }
    // Anything we don't recognise — table cells, html, br, image, etc. —
    // is rendered as raw text via its `raw` field. Cards are inline-only,
    // so this is a defensive fallback rather than the common path.
    default: {
      const raw = (token as { raw?: string; text?: string }).raw ?? (token as { text?: string }).text;
      return raw ? { kind: "text", text: raw } : null;
    }
  }
}

function collectText(segments: MarkdownSegment[]): string {
  let out = "";
  for (const seg of segments) {
    if (seg.kind === "text" || seg.kind === "code" || seg.kind === "tag") {
      out += seg.text;
    } else {
      out += collectText(seg.children);
    }
  }
  return out;
}

export function parseInlineMarkdown(content: string): MarkdownSegment[] {
  if (!content) return [];
  const tokens = lexer.inlineTokens(content) as Tokens.Generic[];
  return convertTokens(tokens);
}
