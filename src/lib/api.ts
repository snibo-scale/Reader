import { invoke, Channel } from "@tauri-apps/api/core";
import type { Paper, Provider } from "../types";

export const listPapers = () => invoke<Paper[]>("list_papers");
export const importPaper = (path: string) => invoke<Paper>("import_paper", { path });
export const deletePaper = (id: string) => invoke<void>("delete_paper", { id });
export const updatePaper = (paper: Paper) => invoke<void>("update_paper", { paper });

export const analyzePaper = (text: string, provider: Provider, model: string | null = null) =>
  invoke<string>("analyze_paper", { text, provider, model });

export const suggestQueries = (context: string, provider: Provider, model: string | null = null) =>
  invoke<string>("suggest_queries", { context, provider, model });

export const extractReferences = (text: string, provider: Provider, model: string | null = null) =>
  invoke<string>("extract_references", { text, provider, model });

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

export const importFromUrl = (url: string) => invoke<Paper>("import_from_url", { url });

export async function readPdfBytes(id: string): Promise<Uint8Array> {
  // The Rust command returns raw bytes, surfaced to JS as an ArrayBuffer.
  const buf = await invoke<ArrayBuffer>("read_pdf_bytes", { id });
  return new Uint8Array(buf);
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
