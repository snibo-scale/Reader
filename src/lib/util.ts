import type { Paper } from "../types";

/** Copy of `paper` with the note on one highlight replaced. */
export function setHighlightNote(paper: Paper, highlightId: string, note: string): Paper {
  return {
    ...paper,
    highlights: paper.highlights.map((h) => (h.id === highlightId ? { ...h, note } : h)),
  };
}

/** Copy of `paper` with one highlight removed. */
export function removeHighlight(paper: Paper, highlightId: string): Paper {
  return { ...paper, highlights: paper.highlights.filter((h) => h.id !== highlightId) };
}

/** arXiv id with any version suffix stripped ("2304.07193v2" -> "2304.07193"), lowercased — the dedupe key. */
export function baseArxivId(id: string): string {
  return id.replace(/v\d+$/i, "").toLowerCase();
}

/** Show the first few authors, then "et al." — keeps cards compact. */
export function formatAuthors(authors: string | string[] | null | undefined, max = 3): string {
  const list = (Array.isArray(authors) ? authors : (authors ?? "").split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return "unknown";
  if (list.length <= max) return list.join(", ");
  return list.slice(0, max).join(", ") + " et al.";
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
