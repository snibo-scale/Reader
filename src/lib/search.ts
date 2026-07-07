import type { Paper } from "../types";

export interface SearchHit {
  paper: Paper;
  score: number;
}

// Lowered search fields, cached per paper object. Paper updates are immutable
// (new object identity), so edited papers recompute and the rest hit the cache.
const fieldCache = new WeakMap<Paper, [string, number][]>();

function searchFields(p: Paper): [string, number][] {
  const hit = fieldCache.get(p);
  if (hit) return hit;
  const idx = p.index;
  const fields: [string, number][] = [
    [p.title.toLowerCase(), 5],
    [(p.authors ?? "").toLowerCase(), 2],
    [(idx?.tags ?? []).join(" ").toLowerCase(), 4],
    [(idx?.topics ?? []).join(" ").toLowerCase(), 3],
    [(idx?.keywords ?? []).join(" ").toLowerCase(), 3],
    [(idx?.summary ?? "").toLowerCase(), 1],
  ];
  fieldCache.set(p, fields);
  return fields;
}

/** Lexical relevance ranking across a paper's title, authors, and index fields. */
export function searchPapers(papers: Paper[], query: string): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const p of papers) {
    let score = 0;
    for (const [lc, weight] of searchFields(p)) {
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
