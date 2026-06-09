import type { Paper } from "../types";

export interface SearchHit {
  paper: Paper;
  score: number;
}

/** Lexical relevance ranking across a paper's title, authors, and index fields. */
export function searchPapers(papers: Paper[], query: string): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const p of papers) {
    const idx = p.index;
    const fields: [string, number][] = [
      [p.title, 5],
      [p.authors ?? "", 2],
      [(idx?.tags ?? []).join(" "), 4],
      [(idx?.topics ?? []).join(" "), 3],
      [(idx?.keywords ?? []).join(" "), 3],
      [idx?.summary ?? "", 1],
    ];
    let score = 0;
    for (const [text, weight] of fields) {
      const lc = text.toLowerCase();
      for (const t of terms) if (lc.includes(t)) score += weight;
    }
    if (score > 0) hits.push({ paper: p, score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Compact, citable context block of the indexed library, for cross-paper Q&A. */
export function libraryContext(papers: Paper[], maxChars = 40000): string {
  let out = "";
  for (const p of papers) {
    if (!p.index) continue;
    const tags = p.index.tags.length ? p.index.tags : p.index.topics;
    const block =
      `### ${p.title}${p.year ? ` (${p.year})` : ""}\n` +
      `Tags: ${tags.join(", ")}\n` +
      `Summary: ${p.index.summary}\n\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out;
}
