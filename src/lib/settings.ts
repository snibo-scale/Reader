import type { Provider } from "../types";

export interface Settings {
  aiProvider: Provider;
  aiModel: string;
  aiInstructions: string;
}

const KEY = "reader.settings";
const DEFAULTS: Settings = { aiProvider: "claude", aiModel: "", aiInstructions: "" };

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
