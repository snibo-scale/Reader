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
  color: string;
  fileName: string;
  addedAt: string;
  lastOpenedAt?: string | null;
  /** ISO timestamp when marked read/done; null/absent = unread. */
  readAt?: string | null;
  sourceKey?: string | null;
  /** SHA-256 of the PDF bytes; used to detect duplicate imports. */
  contentHash?: string | null;
  index?: IndexCard | null;
  /** Extracted references; undefined = not yet extracted, [] = extracted, none found. */
  references?: Reference[] | null;
  highlights: Highlight[];
  /** Free-form, paper-level notes not anchored to any highlight. */
  notes?: string;
  sessions: ChatSession[];
}

/** A named, user-orderable reading list. `paperIds` is the explicit display order. */
export interface ReadingList {
  id: string;
  name: string;
  paperIds: string[];
  createdAt: string;
}

export type Provider = "claude" | "codex";
