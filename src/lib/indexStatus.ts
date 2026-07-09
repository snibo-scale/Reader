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
 * Whether background indexing has work to do. Analysis only — reference
 * extraction is lazy (run on demand from the References panel), so it no longer
 * keeps a paper "unindexed".
 */
export function needsIndexing(p: Paper): boolean {
  return needsAnalysis(p);
}
