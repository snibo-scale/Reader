import type { PDFDocumentProxy } from "pdfjs-dist";
import { readPdfBytes } from "./api";
import { extractHeadings, extractText, loadPdf, type Heading } from "./pdf";

const MAX_ENTRIES = 4;

interface CachedPaper {
  doc?: Promise<PDFDocumentProxy>;
  text?: Promise<string>;
  headings?: Promise<Heading[]>;
}

const cache = new Map<string, CachedPaper>();

function entry(id: string): CachedPaper {
  const existing = cache.get(id);
  if (existing) {
    cache.delete(id);
    cache.set(id, existing);
    return existing;
  }
  const next: CachedPaper = {};
  cache.set(id, next);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return next;
}

export function clearPdfCache(id?: string): void {
  if (id) {
    cache.delete(id);
    localStorage.removeItem(`headings:${id}`);
  } else {
    cache.clear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("headings:")) localStorage.removeItem(key);
    }
  }
}

export function getPdfDoc(id: string): Promise<PDFDocumentProxy> {
  const cached = entry(id);
  cached.doc ??= readPdfBytes(id)
    .then(loadPdf)
    .catch((err) => {
      cached.doc = undefined;
      throw err;
    });
  return cached.doc;
}

export function getPdfText(id: string, doc?: PDFDocumentProxy): Promise<string> {
  const cached = entry(id);
  cached.text ??= (doc ? extractText(doc) : getPdfDoc(id).then(extractText)).catch((err) => {
    cached.text = undefined;
    throw err;
  });
  return cached.text;
}

export function getPdfHeadings(id: string, doc?: PDFDocumentProxy): Promise<Heading[]> {
  const cached = entry(id);
  if (!cached.headings) {
    // Headings are tiny and the PDF is immutable, so persist across sessions
    // to skip the full-document geometry scan on reopen.
    const stored = localStorage.getItem(`headings:${id}`);
    if (stored) {
      try {
        cached.headings = Promise.resolve(JSON.parse(stored) as Heading[]);
        return cached.headings;
      } catch {
        localStorage.removeItem(`headings:${id}`);
      }
    }
    cached.headings = (doc ? extractHeadings(doc) : getPdfDoc(id).then(extractHeadings))
      .then((headings) => {
        try {
          localStorage.setItem(`headings:${id}`, JSON.stringify(headings));
        } catch {
          /* storage full — cache in memory only */
        }
        return headings;
      })
      .catch((err) => {
        cached.headings = undefined;
        throw err;
      });
  }
  return cached.headings;
}
