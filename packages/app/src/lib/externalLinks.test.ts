import { describe, it, expect } from "vitest";
import { extractLinks, linkHintLabels, MAX_LINK_HINTS } from "./externalLinks";

const urls = (content: string) => extractLinks(content).map((link) => link.url);

describe("extractLinks", () => {
  it("returns markdown links and bare URLs in reading order", () => {
    expect(urls("See [docs](https://a.example/docs) then https://b.example/x")).toEqual([
      "https://a.example/docs",
      "https://b.example/x",
    ]);
  });

  it("finds links nested in bold and italic", () => {
    expect(urls("**[a](https://a.example)** *https://b.example*")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("drops duplicate URLs, keeping the first occurrence and its label", () => {
    expect(
      extractLinks("https://a.example [again](https://a.example) https://b.example"),
    ).toEqual([
      { url: "https://a.example", label: null },
      { url: "https://b.example", label: null },
    ]);
  });

  it("ignores non-http(s) links and URLs inside code spans", () => {
    expect(extractLinks("[x](javascript:alert(1)) `https://code.example`")).toEqual([]);
  });

  it("returns nothing for a card without links", () => {
    expect(extractLinks("just a note #tag")).toEqual([]);
    expect(extractLinks("")).toEqual([]);
  });

  it("keeps the display text of a labelled link, including formatting inside it", () => {
    expect(extractLinks("[Release **notes**](https://a.example/notes)")).toEqual([
      { url: "https://a.example/notes", label: "Release notes" },
    ]);
  });

  it("has no label when the text only repeats the URL", () => {
    expect(
      extractLinks("https://a.example www.b.example [https://c.example](https://c.example)"),
    ).toEqual([
      { url: "https://a.example", label: null },
      { url: "http://www.b.example", label: null },
      { url: "https://c.example", label: null },
    ]);
  });
});

describe("linkHintLabels", () => {
  it("uses single digits up to nine links", () => {
    expect(linkHintLabels(3)).toEqual(["1", "2", "3"]);
    expect(linkHintLabels(9)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("pads every label to two digits from ten links", () => {
    expect(linkHintLabels(10)).toEqual([
      "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
    ]);
    expect(linkHintLabels(MAX_LINK_HINTS).at(-1)).toBe("99");
  });
});
