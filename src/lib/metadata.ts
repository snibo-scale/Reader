export interface Analysis {
  title: string;
  year: string;
  authors: string[];
  summary: string;
  topics: string[];
  methods: string[];
  keywords: string[];
  tags: string[];
  contributions: string[];
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

/**
 * Pull a JSON object out of an LLM response (which may be wrapped in prose or
 * code fences) and coerce it into a full Analysis.
 */
export function parseAnalysis(raw: string): Analysis | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    return {
      title: typeof obj.title === "string" ? obj.title.trim() : "",
      year: obj.year != null ? String(obj.year).trim() : "",
      authors: asStringList(obj.authors),
      summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
      topics: asStringList(obj.topics),
      methods: asStringList(obj.methods),
      keywords: asStringList(obj.keywords),
      tags: asStringList(obj.tags),
      contributions: asStringList(obj.contributions),
    };
  } catch {
    return null;
  }
}

/** Parse a JSON array of strings from an LLM response (with light fallbacks). */
export function parseStringArray(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      const list = asStringList(arr);
      if (list.length) return list;
    } catch {
      /* fall through to line parsing */
    }
  }
  return raw
    .split("\n")
    .map((l) => l.replace(/^[\s\-*\d.)"']+/, "").replace(/["']+$/, "").trim())
    .filter((l) => l.length > 1 && l.length < 80);
}
