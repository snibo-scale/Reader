import type { Analysis } from "./metadata";
import type { Paper, Provider } from "../types";
import { analyzePaper, extractReferences, readPaperText } from "./api";
import { getPdfDoc, getPdfText } from "./pdfCache";
import { extractTailText } from "./pdf";
import { parseAnalysis, parseReferences } from "./metadata";
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
 * Index a paper from disk: run ONLY the steps that haven't been done yet
 * (analysis and/or reference extraction), persisting both. Never re-runs a call
 * whose result is already stored. Returns the updated paper, or null if nothing
 * changed / failed.
 */
export async function buildIndex(
  paper: Paper,
  provider: Provider = "claude",
  model: string | null = null
): Promise<Paper | null> {
  if (!needsIndexing(paper)) return null;

  // Markdown docs (imported webpages) have no PDF: analyse the markdown text and
  // mark references N/A ([]) so they're considered fully indexed.
  if (paper.kind === "markdown") {
    let next = paper;
    let changed = false;
    if (needsAnalysis(next)) {
      try {
        const text = await readPaperText(paper.id);
        if (text.trim()) {
          const a = parseAnalysis(await analyzePaper(text, provider, model));
          if (a) {
            next = applyAnalysis(next, a);
            changed = true;
          }
        }
      } catch {
        /* retry next time */
      }
    }
    if (needsReferences(next)) {
      next = { ...next, references: [] };
      changed = true;
    }
    return changed ? next : null;
  }

  const doc = await getPdfDoc(paper.id);
  let next = paper;
  let changed = false;

  if (needsAnalysis(next)) {
    try {
      const text = await getPdfText(paper.id, doc);
      if (text.trim()) {
        const a = parseAnalysis(await analyzePaper(text, provider, model));
        if (a) {
          next = applyAnalysis(next, a);
          changed = true;
        }
      }
    } catch {
      /* leave unindexed; retry next time */
    }
  }

  if (needsReferences(next)) {
    try {
      const tail = await extractTailText(doc);
      next = { ...next, references: parseReferences(await extractReferences(tail, provider, model)) };
      changed = true;
    } catch {
      /* leave references unset; retry next time */
    }
  }

  return changed ? next : null;
}
