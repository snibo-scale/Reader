import { describe, expect, it } from "vitest";
import { parseReferences, salvageObjects } from "./metadata";

describe("salvageObjects", () => {
  it("recovers every well-formed object from a clean list", () => {
    const raw = `[
      {"title":"Attention Is All You Need","authors":"Vaswani et al.","year":"2017","arxivId":"1706.03762"},
      {"title":"BERT","authors":"Devlin et al.","year":"2018","arxivId":""}
    ]`;
    const refs = salvageObjects(raw);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      title: "Attention Is All You Need",
      authors: "Vaswani et al.",
      year: "2017",
      arxivId: "1706.03762",
    });
  });

  it("recovers objects from a truncated (never-closed) array", () => {
    // Model ran out of output budget mid-array: no closing `}` or `]`.
    const raw = `[
      {"title":"First Paper","authors":"A. One","year":"2020","arxivId":""},
      {"title":"Second Paper","authors":"B. Two","year":"2021","arxivId":""},
      {"title":"Third Paper incomplete","autho`;
    const refs = salvageObjects(raw);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.title)).toEqual(["First Paper", "Second Paper"]);
  });

  it("skips one malformed object but keeps the rest", () => {
    const raw = `[
      {"title":"Good One","authors":"A","year":"2019","arxivId":""},
      {"title":"Bad One", BROKEN},
      {"title":"Good Two","authors":"B","year":"2020","arxivId":""}
    ]`;
    const refs = salvageObjects(raw);
    expect(refs.map((r) => r.title)).toEqual(["Good One", "Good Two"]);
  });

  it("is not fooled by braces inside string values", () => {
    const raw = `[{"title":"On {curly} sets and } edge cases","authors":"C","year":"2022","arxivId":""}]`;
    const refs = salvageObjects(raw);
    expect(refs).toHaveLength(1);
    expect(refs[0].title).toBe("On {curly} sets and } edge cases");
  });
});

describe("parseReferences", () => {
  it("uses the fast path on a clean array", () => {
    const raw = `Here are the refs: [{"title":"X","authors":"Y","year":"2020","arxivId":""}]`;
    expect(parseReferences(raw)).toHaveLength(1);
  });

  it("falls back to salvage on a truncated array and drops titleless entries", () => {
    const raw = `[
      {"title":"Kept","authors":"A","year":"2020","arxivId":""},
      {"title":"","authors":"B","year":"2021","arxivId":""},
      {"title":"Truncated`;
    const refs = parseReferences(raw);
    expect(refs.map((r) => r.title)).toEqual(["Kept"]);
  });
});
