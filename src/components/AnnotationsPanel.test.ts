import { describe, expect, it } from "vitest";
import { locate } from "./AnnotationsPanel";

describe("locate", () => {
  const doc = "We propose the transformer architecture, which relies on attention.";

  it("finds an exact substring", () => {
    expect(locate(doc, "transformer architecture")).toEqual({ a: 15, b: 39 });
  });

  it("tolerates whitespace differences (newlines/multiple spaces)", () => {
    // A clipped selection often collapses or re-wraps whitespace.
    expect(locate(doc, "transformer\n  architecture")).toEqual({ a: 15, b: 39 });
  });

  it("returns null when the text isn't present", () => {
    expect(locate(doc, "recurrent network")).toBeNull();
  });

  it("returns null for empty inputs", () => {
    expect(locate("", "x")).toBeNull();
    expect(locate(doc, "   ")).toBeNull();
  });
});
