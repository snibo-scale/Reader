import Defuddle from "defuddle/full";
import { fetchUrl, importMarkdown } from "./api";
import type { Paper } from "../types";

/**
 * Fetch a webpage and import it as a markdown paper. Uses Defuddle (the same
 * extractor Obsidian Web Clipper uses) for both content extraction and the
 * HTML→markdown conversion — consistent footnotes/math/code/tables and richer
 * metadata than Readability. Conversion runs in the webview because Defuddle
 * needs a DOM; the fetch is done in Rust to avoid CORS.
 */
export async function importWebpage(url: string): Promise<Paper> {
  const html = await fetchUrl(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Give Defuddle an absolute base so relative links/images resolve.
  const base = doc.createElement("base");
  base.href = url;
  doc.head.prepend(base);

  const result = new Defuddle(doc, { url, markdown: true }).parse();
  const markdown = (result.content ?? "").trim();
  if (!markdown) throw new Error("Couldn't extract readable content from that page");

  const title = (result.title || doc.title || url).trim();
  const author = result.author?.trim() || undefined;
  const year = result.published?.match(/\b(\d{4})\b/)?.[1];

  // Defuddle strips the title into metadata; keep it in the body as an H1 unless
  // the extracted content already leads with it.
  const firstLine = markdown.split("\n", 1)[0].trim();
  const hasTitle = firstLine.replace(/^#+\s*/, "") === title;
  const body = hasTitle ? markdown : `# ${title}\n\n${markdown}`;

  return importMarkdown(title, body, url, author, year);
}
