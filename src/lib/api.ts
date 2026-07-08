import { invoke, Channel } from "@tauri-apps/api/core";
import type { Paper, Provider, ReadingList } from "../types";
import { getIndexPrompt, getRefsPrompt } from "./settings";

export const listPapers = () => invoke<Paper[]>("list_papers");
export const importPaper = (path: string) => invoke<Paper>("import_paper", { path });
export const deletePaper = (id: string) => invoke<void>("delete_paper", { id });
export const updatePaper = (paper: Paper) => invoke<void>("update_paper", { paper });

export const listReadingLists = () => invoke<ReadingList[]>("list_reading_lists");
export const saveReadingLists = (lists: ReadingList[]) =>
  invoke<void>("save_reading_lists", { lists });

// Truncation limits that used to live in the Rust prompt builders; the frontend
// now owns the prompt, so it bounds the text it pastes into the template.
const INDEX_TEXT_LIMIT = 12_000;
const REFS_TEXT_LIMIT = 60_000;

const fillPrompt = (template: string, text: string, limit: number) =>
  template.replace("{{text}}", text.slice(0, limit));

/** Run a fully-built prompt through the local CLI and return its raw stdout. */
export const runPrompt = (prompt: string, provider: Provider, model: string | null = null) =>
  invoke<string>("run_prompt", { prompt, provider, model });

export const analyzePaper = (text: string, provider: Provider, model: string | null = null) =>
  runPrompt(fillPrompt(getIndexPrompt(), text, INDEX_TEXT_LIMIT), provider, model);

export const suggestQueries = (context: string, provider: Provider, model: string | null = null) =>
  invoke<string>("suggest_queries", { context, provider, model });

export const extractReferences = (text: string, provider: Provider, model: string | null = null) =>
  runPrompt(fillPrompt(getRefsPrompt(), text, REFS_TEXT_LIMIT), provider, model);

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  year: string;
  link: string;
}

export const arxivSearch = (query: string, max = 6) =>
  invoke<ArxivPaper[]>("arxiv_search", { query, max });

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

export const importFromResearch = () => invoke<ImportResult>("import_from_research");

export const exportLibrary = (path: string) => invoke<number>("export_library", { path });
export const importLibrary = (path: string) => invoke<ImportResult>("import_library", { path });

/** Write one paper + its file bytes + annotations to a shareable `.reader` file. */
export const exportPaper = (id: string, path: string) => invoke<void>("export_paper", { id, path });

/** Import a shared `.reader` file, recovering its file and annotations. */
export const importPaperFile = (path: string) => invoke<Paper>("import_paper_file", { path });

export const importFromUrl = (url: string) => invoke<Paper>("import_from_url", { url });

/** Fetch a webpage's raw HTML (backend, to dodge webview CORS). */
export const fetchUrl = (url: string) => invoke<string>("fetch_url", { url });

/** Store converted markdown as a paper. */
export const importMarkdown = (
  title: string,
  markdown: string,
  url: string,
  author?: string,
  year?: string
) => invoke<Paper>("import_markdown", { title, markdown, url, author, year });

export async function readPdfBytes(id: string): Promise<Uint8Array> {
  // The Rust command returns raw bytes, surfaced to JS as an ArrayBuffer.
  const buf = await invoke<ArrayBuffer>("read_pdf_bytes", { id });
  return new Uint8Array(buf);
}

/** Read a markdown paper's source text (reuses read_pdf_bytes — it reads any file). */
export async function readPaperText(id: string): Promise<string> {
  return new TextDecoder().decode(await readPdfBytes(id));
}

export type AiEvent =
  | { event: "chunk"; data: { text: string } }
  | { event: "done"; data?: null }
  | { event: "error"; data: { message: string } };

export interface AskRequest {
  paperId: string;
  prompt: string;
  context: string;
  provider: Provider;
  model?: string | null;
}

export function askAi(request: AskRequest, onEvent: (e: AiEvent) => void): Promise<void> {
  const channel = new Channel<AiEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("ask_ai", { request, onEvent: channel });
}
