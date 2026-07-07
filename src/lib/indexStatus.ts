import type { Paper } from "../types";

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
 * done.
 */
export function needsIndexing(p: Paper): boolean {
  return needsAnalysis(p) || needsReferences(p);
}
