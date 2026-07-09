import type { Analysis } from "./metadata";
import type { Paper, Provider } from "../types";
import { analyzePaper, readPaperText } from "./api";
import { getPdfDoc, getPdfText } from "./pdfCache";
import { parseAnalysis } from "./metadata";
import { canonicalTag } from "./canonical";
import { needsAnalysis, needsIndexing, needsReferences } from "./indexStatus";

/** Merge an LLM analysis into a paper (metadata + index card). */
export function applyAnalysis(paper: Paper, a: Analysis): Paper {
  return {
    ...paper,
    title: a.title || paper.title,
    year: a.year || paper.year,
    authors: a.authors.length ? a.authors.join(", ") : paper.authors,
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

export { needsAnalysis, needsIndexing, needsReferences };

/**
 * Index a paper from disk. Background indexing is ANALYSIS ONLY (summary/topics/
 * metadata) — reference extraction is lazy, run on demand from the References
 * panel (Workspace.reExtractRefs), since it's the slowest call and often unused.
 * Returns the updated paper, or null if nothing changed / failed.
 */
export async function buildIndex(
  paper: Paper,
  provider: Provider = "claude",
  model: string | null = null
): Promise<Paper | null> {
  if (!needsAnalysis(paper)) return null;

  try {
    // Markdown docs (imported webpages) have no PDF and no bibliography: analyse
    // the markdown text and stamp references N/A ([]).
    if (paper.kind === "markdown") {
      const text = await readPaperText(paper.id);
      if (!text.trim()) return null;
      const a = parseAnalysis(await analyzePaper(text, provider, model));
      return a ? { ...applyAnalysis(paper, a), references: paper.references ?? [] } : null;
    }

    const doc = await getPdfDoc(paper.id);
    const text = await getPdfText(paper.id, doc);
    if (!text.trim()) return null;
    const a = parseAnalysis(await analyzePaper(text, provider, model));
    return a ? applyAnalysis(paper, a) : null;
  } catch {
    return null; // leave unindexed; retry next open
  }
}
