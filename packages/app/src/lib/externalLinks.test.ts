import { describe, it, expect } from "vitest";
import { extractLinks } from "./externalLinks";

describe("extractLinks", () => {
  it("returns markdown links and bare URLs in reading order", () => {
    expect(
      extractLinks("See [docs](https://a.example/docs) then https://b.example/x"),
    ).toEqual(["https://a.example/docs", "https://b.example/x"]);
  });

  it("finds links nested in bold and italic", () => {
    expect(extractLinks("**[a](https://a.example)** *https://b.example*")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("drops duplicates, keeping the first occurrence", () => {
    expect(
      extractLinks("https://a.example [again](https://a.example) https://b.example"),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("ignores non-http(s) links and URLs inside code spans", () => {
    expect(extractLinks("[x](javascript:alert(1)) `https://code.example`")).toEqual([]);
  });

  it("returns nothing for a card without links", () => {
    expect(extractLinks("just a note #tag")).toEqual([]);
    expect(extractLinks("")).toEqual([]);
  });
});
