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

import type { Reference } from "../types";
export type { Reference };

const toReference = (o: Record<string, unknown>): Reference => ({
  title: String(o.title ?? "").trim(),
  authors: String(o.authors ?? "").trim(),
  year: o.year != null ? String(o.year).trim() : "",
  arxivId: String(o.arxivId ?? "").trim(),
});

/**
 * Scan a string for top-level JSON objects (`{...}`) and parse each one
 * independently. Used as a fallback when the surrounding array is truncated
 * (long bibliography exceeds the model's output budget) or one entry is
 * malformed — so we recover every well-formed reference instead of none.
 */
export function salvageObjects(raw: string): Reference[] {
  const out: Reference[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          out.push(toReference(JSON.parse(raw.slice(start, i + 1))));
        } catch {
          /* skip this object, keep scanning */
        }
        start = -1;
      }
    }
  }
  return out;
}

/** Parse a JSON array of references from an LLM response. */
export function parseReferences(raw: string): Reference[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  let refs: Reference[] | null = null;
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(arr)) refs = arr.map(toReference);
    } catch {
      /* fall back to per-object salvage below */
    }
  }
  // Whole-array parse failed (truncated/malformed) — recover individual objects.
  if (refs === null) refs = salvageObjects(raw);
  return refs.filter((r) => r.title.length > 0);
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
