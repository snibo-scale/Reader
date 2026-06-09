import type { Analysis } from "./metadata";
import type { Paper, Provider } from "../types";
import { analyzePaper, readPdfBytes } from "./api";
import { extractText, loadPdf } from "./pdf";
import { parseAnalysis } from "./metadata";
import { canonicalTag } from "./canonical";

/** Merge an LLM analysis into a paper (metadata + index card). */
export function applyAnalysis(paper: Paper, a: Analysis): Paper {
  return {
    ...paper,
    title: a.title || paper.title,
    year: a.year || paper.year,
    authors: a.authors.length ? a.authors.join(", ") : paper.authors,
    metadataExtracted: true,
    index: {
      summary: a.summary,
      topics: a.topics,
      methods: a.methods,
      keywords: a.keywords.length ? a.keywords : paper.index?.keywords ?? [],
      tags: [...new Set(a.tags.map(canonicalTag).filter((t) => t.length > 2))],
      contributions: a.contributions,
      indexedAt: new Date().toISOString(),
    },
  };
}

/** Full pipeline for indexing a paper from disk (used by the bulk indexer). */
export async function buildIndex(
  paper: Paper,
  provider: Provider = "claude",
  model: string | null = null
): Promise<Paper | null> {
  const bytes = await readPdfBytes(paper.id);
  const doc = await loadPdf(bytes);
  const text = await extractText(doc);
  if (!text.trim()) return null;
  const raw = await analyzePaper(text, provider, model);
  const a = parseAnalysis(raw);
  return a ? applyAnalysis(paper, a) : null;
}

/** A paper needs indexing if it has no index yet, or only a keyword seed. */
export function needsIndexing(p: Paper): boolean {
  return !p.index || p.index.topics.length === 0;
}
