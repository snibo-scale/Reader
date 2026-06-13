import type { Paper } from "../types";
import { paperTags } from "./canonical";

function jaccard(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  if (!a.size || !b.size) return { score: 0, shared: [] };
  const shared: string[] = [];
  for (const t of a) if (b.has(t)) shared.push(t);
  const union = new Set([...a, ...b]).size;
  return { score: shared.length / union, shared };
}

/** Papers most related to a given paper, strongest first. */
export function relatedPapers(paperId: string, papers: Paper[], limit = 5): { paper: Paper; score: number; shared: string[] }[] {
  const self = papers.find((p) => p.id === paperId);
  if (!self) return [];
  const selfTokens = paperTags(self);
  return papers
    .filter((p) => p.id !== paperId)
    .map((p) => ({ paper: p, ...jaccard(selfTokens, paperTags(p)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Library papers whose canonical tags appear in some text (e.g. a recommendation). */
export function similarInLibrary(text: string, papers: Paper[], limit = 3): { paper: Paper; score: number }[] {
  const hay = text.toLowerCase();
  return papers
    .filter((p) => p.index)
    .map((p) => {
      let score = 0;
      for (const t of paperTags(p)) if (t.length > 3 && hay.includes(t)) score++;
      return { paper: p, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Aggregate reading profile (top topics + keywords) used to seed recommendations. */
export function readingProfile(papers: Paper[]): { topics: string[]; keywords: string[]; titles: string[] } {
  const topicCount = new Map<string, number>();
  const kwCount = new Map<string, number>();
  const titles: string[] = [];
  for (const p of papers) {
    if (p.index) {
      titles.push(p.title);
      for (const t of p.index.topics) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
      for (const k of p.index.keywords) kwCount.set(k, (kwCount.get(k) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return { topics: top(topicCount, 12), keywords: top(kwCount, 20), titles: titles.slice(0, 25) };
}
