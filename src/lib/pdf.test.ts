import { describe, expect, it } from "vitest";
import { looksLikeSection } from "./pdf";

describe("looksLikeSection", () => {
  it("accepts canonical section names", () => {
    for (const s of ["Introduction", "Related Work", "Method", "Design", "References", "Bibliography", "Conclusion"])
      expect(looksLikeSection(s)).toBe(true);
  });

  it("accepts numbered / lettered headings, incl. custom titles", () => {
    for (const s of ["3.1 Experimental Setup", "2 Approach", "IV. Results", "A. Notation", "5 Scaling Laws"])
      expect(looksLikeSection(s)).toBe(true);
  });

  it("accepts a canonical word after a section number", () => {
    expect(looksLikeSection("4. Evaluation")).toBe(true);
  });

  it("rejects prose, captions, and author lines", () => {
    for (const s of [
      "Figure 3: accuracy over training steps",
      "We evaluate our approach on three datasets and find that",
      "Jane Doe, John Smith, University of Somewhere",
      "as shown in the previous section, the model converges",
    ])
      expect(looksLikeSection(s)).toBe(false);
  });
});
