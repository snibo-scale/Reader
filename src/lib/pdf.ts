import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
// Vite resolves this to a hashed asset URL for the worker.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js may transfer/detach the underlying buffer, so hand it a copy.
  const data = bytes.slice();
  return pdfjsLib.getDocument({ data }).promise;
}

const REFS_HEADING = /^(\d+(\.\d+)*\.?\s*|[IVXLC]+\.\s*)?(references|bibliography|works\s+cited)\b/i;

// Text spanning [start, end) by vertical position: from the `start` heading to
// the `end` heading (or the document end when `end` is undefined). Boundary
// pages are clipped by baseline position so we grab exactly that section.
async function textBetween(
  doc: PDFDocumentProxy,
  start: Heading,
  end: Heading | undefined,
  maxChars: number
): Promise<string> {
  const Util = (pdfjsLib as unknown as { Util: { transform: (a: number[], b: number[]) => number[] } }).Util;
  const endPage = end ? end.page : doc.numPages;
  let out = "";
  for (let i = start.page; i <= endPage; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const tx = Util.transform(vp.transform as unknown as number[], it.transform as number[]);
      const yb = tx[5] / vp.height; // baseline, top-origin fraction
      if (i === start.page && yb < start.yFrac) continue; // above the References heading
      if (end && i === end.page && yb >= end.yFrac) continue; // at/after the next section
      out += it.str + " ";
    }
    out += "\n";
    if (out.length > maxChars) break;
  }
  return out.slice(0, maxChars);
}

async function extractPagesText(
  doc: PDFDocumentProxy,
  startPage: number,
  endPage: number,
  maxChars: number
): Promise<string> {
  let out = "";
  for (let i = startPage; i <= endPage; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    if (out.length > maxChars) break;
  }
  return out.slice(-maxChars);
}

export interface Heading {
  text: string;
  page: number;
  yFrac: number; // 0 (top) .. 1 (bottom) within the page, for scroll targeting
  level: number; // 0 = largest heading; deeper = smaller font
}

// A leading section number: "3", "3.1", "IV.", "A." — with heading text after.
const NUMBERED = /^\s*(\d+(\.\d+)*\.?|[IVXLC]+\.|[A-Z]\.)\s+[A-Za-z]/;
// Canonical section names (optionally after a section number).
const SECTION_WORDS =
  /^(abstract|introduction|background|related\s+work|prior\s+work|preliminaries|motivation|problem\s+statement|method(s|ology)?|approach|design|architecture|model|framework|system|implementation|experiment(s|al)?|setup|evaluation|dataset(s)?|result(s)?|analysis|discussion|ablation(s)?|limitation(s)?|conclusion(s)?|future\s+work|acknowledge?ment(s)?|reference(s)?|bibliograph(y|ie)|appendix|supplement(ary)?)\b/i;

// Keep only lines that read like a real section heading — a numbered heading,
// or one starting with a canonical section word (with any leading number stripped).
export function looksLikeSection(text: string): boolean {
  const t = text.trim();
  if (NUMBERED.test(t)) return true;
  const stripped = t.replace(/^\s*(\d+(\.\d+)*\.?|[IVXLC]+\.|[A-Z]\.)\s*/, "");
  return SECTION_WORDS.test(stripped);
}

// Detect section headings by font size: lines set noticeably larger than the
// body text are treated as candidates, then filtered to ones that read like a
// real section (looksLikeSection). No embedded outline is required (most arXiv
// PDFs lack one), so this reads the geometry PDF.js already gives us.
async function extractHeadingsRange(
  doc: PDFDocumentProxy,
  startPage: number,
  endPage: number
): Promise<Heading[]> {
  const Util = (pdfjsLib as unknown as { Util: { transform: (a: number[], b: number[]) => number[] } }).Util;
  type Line = { page: number; yFrac: number; size: number; text: string };
  const lines: Line[] = [];
  const sizeChars = new Map<number, number>(); // rounded size -> total chars (body = the mode)

  for (let i = startPage; i <= endPage; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Group items sharing a baseline into one visual line.
    const byLine = new Map<number, { size: number; yTop: number; parts: { x: number; s: string }[] }>();
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const tx = Util.transform(vp.transform as unknown as number[], it.transform as number[]);
      const size = Math.round(Math.hypot(tx[2], tx[3]));
      if (size === 0) continue;
      sizeChars.set(size, (sizeChars.get(size) ?? 0) + it.str.length);
      const key = Math.round(tx[5]);
      const g = byLine.get(key) ?? { size, yTop: tx[5] - size, parts: [] };
      g.size = Math.max(g.size, size);
      g.parts.push({ x: tx[4], s: it.str });
      byLine.set(key, g);
    }
    for (const g of byLine.values()) {
      const text = g.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) lines.push({ page: i, yFrac: Math.max(0, g.yTop) / vp.height, size: g.size, text });
    }
  }

  let body = 0;
  let bodyChars = -1;
  for (const [s, c] of sizeChars) if (c > bodyChars) ((bodyChars = c), (body = s));

  const heads = lines.filter(
    (l) => l.size >= body * 1.08 && l.text.length >= 3 && l.text.length <= 90 && looksLikeSection(l.text)
  );
  // Drop running headers/footers: same text repeating across many pages.
  const seen = new Map<string, number>();
  for (const h of heads) seen.set(h.text.toLowerCase(), (seen.get(h.text.toLowerCase()) ?? 0) + 1);
  const kept = heads.filter((h) => (seen.get(h.text.toLowerCase()) ?? 0) <= 3);

  const sizes = [...new Set(kept.map((h) => h.size))].sort((a, b) => b - a);
  return kept.map((h) => ({ text: h.text, page: h.page, yFrac: h.yFrac, level: sizes.indexOf(h.size) }));
}

export async function extractHeadings(doc: PDFDocumentProxy): Promise<Heading[]> {
  return extractHeadingsRange(doc, 1, doc.numPages);
}

/**
 * Text of the references section: from the References/Bibliography/Works Cited
 * heading to the next section (or the document end). Checks the tail pages first
 * so ordinary papers avoid a full-document heading scan.
 */
export async function extractTailText(doc: PDFDocumentProxy, tailPages = 16, maxChars = 60000): Promise<string> {
  const start = Math.max(1, doc.numPages - tailPages + 1);
  const tailHeads = await extractHeadingsRange(doc, start, doc.numPages);
  const tailRefIdx = tailHeads.findIndex((h) => REFS_HEADING.test(h.text.trim()));
  if (tailRefIdx >= 0) {
    const between = await textBetween(doc, tailHeads[tailRefIdx], tailHeads[tailRefIdx + 1], maxChars);
    if (between.trim()) return between;
  }

  const tailText = await extractPagesText(doc, start, doc.numPages, maxChars);
  if (tailText.split(/\n+/).some((line) => REFS_HEADING.test(line.trim()))) return tailText;

  const heads = start > 1 ? await extractHeadingsRange(doc, 1, start - 1) : [];
  const refIdx = heads.findIndex((h) => REFS_HEADING.test(h.text.trim()));
  if (refIdx >= 0) {
    const between = await textBetween(doc, heads[refIdx], heads[refIdx + 1] ?? tailHeads[0], maxChars);
    if (between.trim()) return between;
  }

  return tailText;
}

export async function extractText(doc: PDFDocumentProxy, maxChars = 48000): Promise<string> {
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ");
    out += pageText + "\n\n";
    if (out.length > maxChars) break;
  }
  return out.slice(0, maxChars);
}
