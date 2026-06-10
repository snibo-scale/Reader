import type { Analysis } from "./metadata";
import type { Paper, Provider } from "../types";
import { analyzePaper, extractReferences, readPdfBytes } from "./api";
import { extractTailText, extractText, loadPdf } from "./pdf";
import { parseAnalysis, parseReferences } from "./metadata";
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

/** Analysis (summary/topics/metadata) hasn't been generated yet. */
export function needsAnalysis(p: Paper): boolean {
  return !p.index || p.index.topics.length === 0;
}

/** References haven't been extracted yet (null/undefined; [] means "extracted, none"). */
export function needsReferences(p: Paper): boolean {
  return p.references == null;
}

/**
 * A paper isn't fully indexed until BOTH its analysis and its references are
 * done. Reference extraction is part of indexing, so a paper missing either
 * step still "needs indexing" and is picked up by Index all.
 */
export function needsIndexing(p: Paper): boolean {
  return needsAnalysis(p) || needsReferences(p);
}

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
  const bytes = await readPdfBytes(paper.id);
  const doc = await loadPdf(bytes);
  let next = paper;
  let changed = false;

  if (needsAnalysis(next)) {
    try {
      const text = await extractText(doc);
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
