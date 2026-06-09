export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Highlight {
  id: string;
  page: number;
  text: string;
  rects: Rect[];
  color: string;
  note?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface Reference {
  title: string;
  authors: string;
  year: string;
  arxivId: string;
}

export interface IndexCard {
  summary: string;
  topics: string[];
  methods: string[];
  keywords: string[];
  tags: string[];
  contributions: string[];
  indexedAt: string;
}

export interface Paper {
  id: string;
  title: string;
  authors?: string | null;
  year?: string | null;
  category: string;
  color: string;
  fileName: string;
  addedAt: string;
  lastOpenedAt?: string | null;
  progress?: number | null;
  metadataExtracted?: boolean;
  sourceKey?: string | null;
  index?: IndexCard | null;
  /** Extracted references; undefined = not yet extracted, [] = extracted, none found. */
  references?: Reference[] | null;
  highlights: Highlight[];
  /** Legacy single conversation, migrated into sessions on load. */
  chat?: ChatMessage[];
  sessions: ChatSession[];
}

export type Provider = "claude" | "codex";
