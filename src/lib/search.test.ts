import { describe, expect, it } from "vitest";
import type { Paper } from "../types";
import { searchPapers } from "./search";

function paper(id: string, title: string, tags: string[] = []): Paper {
  return {
    id,
    title,
    color: "",
    fileName: `${id}.pdf`,
    addedAt: "2026-01-01T00:00:00.000Z",
    highlights: [],
    sessions: [],
    index: tags.length
      ? { summary: "", tags, topics: [], keywords: [], methods: [], contributions: [] }
      : undefined,
  } as unknown as Paper;
}

describe("searchPapers", () => {
  const papers = [
    paper("a", "Attention Is All You Need", ["transformer"]),
    paper("b", "Diffusion Policy"),
    paper("c", "Unrelated"),
  ];

  it("ranks matches and ignores non-matches", () => {
    const hits = searchPapers(papers, "transformer attention");
    expect(hits.map((h) => h.paper.id)).toEqual(["a"]);
  });

  it("returns identical results on a repeat query (cached lowered fields)", () => {
    const first = searchPapers(papers, "diffusion");
    const second = searchPapers(papers, "diffusion");
    expect(second).toEqual(first);
    expect(second[0].paper.id).toBe("b");
  });

  it("sees updated fields on a new paper object (cache keyed by identity)", () => {
    const updated = papers.map((p) => (p.id === "c" ? { ...p, title: "Diffusion Survey" } : p));
    const hits = searchPapers(updated, "diffusion");
    expect(hits.map((h) => h.paper.id).sort()).toEqual(["b", "c"]);
  });
});
