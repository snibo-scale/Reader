import type { Provider } from "../types";

export type Theme = "minimal" | "classic";

export interface Settings {
  aiProvider: Provider;
  aiModel: string;
  aiInstructions: string;
  indexPrompt: string;
  refsPrompt: string;
  theme: Theme;
}

// `{{text}}` is replaced with the (truncated) paper text before the prompt is sent.
export const DEFAULT_INDEX_PROMPT = `You are building a research index card for an academic paper. Read the text and respond with ONLY a single compact JSON object, no markdown fences and no commentary, in exactly this shape:
{"title":"","year":"","authors":[""],"summary":"","topics":[""],"methods":[""],"keywords":[""],"tags":[""],"contributions":[""]}
- title: the paper's full title.
- year: the 4-digit publication year.
- authors: author full names, in order.
- summary: a 2-3 sentence plain-language summary.
- topics: 3-6 broad research areas / subfields.
- methods: key techniques, models, or algorithms used.
- keywords: 5-10 specific technical terms.
- tags: 5-10 CANONICAL concept tags for linking related papers. Normalize aggressively: all lowercase; expand acronyms to their full canonical name (e.g. use "vision-language-action model" not "VLA", "reinforcement learning" not "RL", "vision transformer" not "ViT", "self-supervised learning" not "SSL"); use the singular, widely-used phrasing; do NOT include paper-specific names, datasets, or benchmarks.
- contributions: the main contributions, one short phrase each.
Use empty strings or empty lists for anything you cannot determine.

PAPER TEXT:
{{text}}`;

export const DEFAULT_REFS_PROMPT = `The text below is the end of an academic paper, including its References / Bibliography. Extract EVERY cited work you can identify. Respond with ONLY a JSON array, each item exactly this shape:
{"title":"","authors":"","year":"","arxivId":""}
- title: the cited paper's title.
- authors: first author et al. (short).
- year: 4-digit year if present.
- arxivId: the arXiv id (e.g. 2401.01234) ONLY if explicitly present in the text, else "".
Include all clearly identifiable references (there may be 100 or more). Do not stop early or summarize. No commentary, no markdown.

TEXT:
{{text}}`;

const KEY = "reader.settings";
const DEFAULTS: Settings = {
  aiProvider: "claude",
  aiModel: "",
  aiInstructions: "",
  indexPrompt: DEFAULT_INDEX_PROMPT,
  refsPrompt: DEFAULT_REFS_PROMPT,
  theme: "minimal",
};

export function getSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** Reflect the chosen theme onto <html data-theme>; CSS + tagTint switch off it. */
export function applyTheme(t?: Theme): void {
  document.documentElement.dataset.theme = t ?? getSettings().theme;
}

/** The configured default provider, used by indexing / Q&A / recommendations / chat. */
export function getProvider(): Provider {
  return getSettings().aiProvider;
}

/** Optional --model override; null when blank (use the CLI default). */
export function getModel(): string | null {
  const m = getSettings().aiModel.trim();
  return m || null;
}

/** Custom instructions prepended to conversational prompts (chat, search Q&A). */
export function getInstructions(): string {
  return getSettings().aiInstructions.trim();
}

/** Prepend custom instructions to a prompt, when set. */
export function withInstructions(prompt: string): string {
  const instr = getInstructions();
  return instr ? `Instructions: ${instr}\n\n${prompt}` : prompt;
}

/** Editable indexing/analysis prompt template (contains a `{{text}}` placeholder). */
export function getIndexPrompt(): string {
  return getSettings().indexPrompt.trim() || DEFAULT_INDEX_PROMPT;
}

/** Editable reference-extraction prompt template (contains a `{{text}}` placeholder). */
export function getRefsPrompt(): string {
  return getSettings().refsPrompt.trim() || DEFAULT_REFS_PROMPT;
}
