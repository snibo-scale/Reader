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

/** Text from the last pages of a PDF — where the references/bibliography live. */
export async function extractTailText(doc: PDFDocumentProxy, tailPages = 12, maxChars = 45000): Promise<string> {
  const start = Math.max(1, doc.numPages - tailPages + 1);
  let out = "";
  for (let i = start; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return out.slice(-maxChars);
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
