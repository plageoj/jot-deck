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
      { kind: "bold", text: "bold" },
      { kind: "text", text: " b" },
    ]);
  });

  it("parses italic (*...*)", () => {
    expect(parseInlineMarkdown("be *quick*")).toEqual([
      { kind: "text", text: "be " },
      { kind: "italic", text: "quick" },
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
        text: "docs",
        href: "https://example.com",
      },
    ]);
  });

  it("preserves #tag segments inline with markdown", () => {
    const result = parseInlineMarkdown("**todo** #urgent");
    expect(result).toEqual([
      { kind: "bold", text: "todo" },
      { kind: "text", text: " " },
      { kind: "tag", text: "#urgent", tagName: "urgent" },
    ]);
  });

  it("does not treat snake_case as italic", () => {
    expect(parseInlineMarkdown("var snake_case_value end")).toEqual([
      { kind: "text", text: "var snake_case_value end" },
    ]);
  });
});
