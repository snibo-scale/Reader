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
