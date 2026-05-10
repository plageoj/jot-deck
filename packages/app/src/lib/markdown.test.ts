import { describe, expect, it } from "vitest";
import { parseInlineMarkdown } from "./markdown";

describe("parseInlineMarkdown", () => {
  it("returns a single text segment for plain content", () => {
    expect(parseInlineMarkdown("hello world")).toEqual([
      { kind: "text", text: "hello world" },
    ]);
  });

  it("parses bold (**...**)", () => {
    expect(parseInlineMarkdown("a **bold** b")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", children: [{ kind: "text", text: "bold" }] },
      { kind: "text", text: " b" },
    ]);
  });

  it("parses italic (*...*)", () => {
    expect(parseInlineMarkdown("be *quick*")).toEqual([
      { kind: "text", text: "be " },
      { kind: "italic", children: [{ kind: "text", text: "quick" }] },
    ]);
  });

  it("parses inline code", () => {
    expect(parseInlineMarkdown("run `pnpm dev`")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "pnpm dev" },
    ]);
  });

  it("parses http(s) links", () => {
    expect(parseInlineMarkdown("see [docs](https://example.com)")).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "link",
        href: "https://example.com",
        children: [{ kind: "text", text: "docs" }],
      },
    ]);
  });

  it("preserves #tag segments inline with markdown", () => {
    expect(parseInlineMarkdown("**todo** #urgent")).toEqual([
      { kind: "bold", children: [{ kind: "text", text: "todo" }] },
      { kind: "text", text: " " },
      { kind: "tag", text: "#urgent", tagName: "urgent" },
    ]);
  });

  it("does not treat snake_case as italic", () => {
    expect(parseInlineMarkdown("var snake_case_value end")).toEqual([
      { kind: "text", text: "var snake_case_value end" },
    ]);
  });

  it("keeps #tag detectable when wrapped by bold", () => {
    expect(parseInlineMarkdown("**#urgent**")).toEqual([
      {
        kind: "bold",
        children: [{ kind: "tag", text: "#urgent", tagName: "urgent" }],
      },
    ]);
  });

  it("keeps #tag detectable when wrapped by italic underscores", () => {
    expect(parseInlineMarkdown("_#urgent_")).toEqual([
      {
        kind: "italic",
        children: [{ kind: "tag", text: "#urgent", tagName: "urgent" }],
      },
    ]);
  });

  it("treats code spans as opaque (no nested tag detection)", () => {
    // Backticks signal literal content; `#tag` inside is not clickable.
    expect(parseInlineMarkdown("`#urgent`")).toEqual([
      { kind: "code", text: "#urgent" },
    ]);
  });

  it("keeps #tag detectable inside link labels", () => {
    expect(parseInlineMarkdown("[#urgent](https://example.com)")).toEqual([
      {
        kind: "link",
        href: "https://example.com",
        children: [{ kind: "tag", text: "#urgent", tagName: "urgent" }],
      },
    ]);
  });
});
