import type { Paper } from "../types";

const STOP = new Set(["the", "and", "for", "with", "based", "via", "using", "a", "of", "to", "model", "models"]);

// Synonyms / acronyms -> a single canonical token. Keys are in normalized form
// (lowercase, hyphens & underscores -> spaces, punctuation stripped).
const ALIASES: Record<string, string> = {
  vla: "vision-language-action model",
  "vision language action": "vision-language-action model",
  "vision language action model": "vision-language-action model",
  "vision language action policy": "vision-language-action model",
  vlm: "vision-language model",
  "vision language model": "vision-language model",
  "vision language pretraining": "vision-language model",
  llm: "large language model",
  "large language model": "large language model",
  rl: "reinforcement learning",
  rlhf: "reinforcement learning from human feedback",
  bc: "imitation learning",
  "behavior cloning": "imitation learning",
  "behavioural cloning": "imitation learning",
  "behavioral cloning": "imitation learning",
  "imitation learning": "imitation learning",
  vit: "vision transformer",
  "vision transformer": "vision transformer",
  ssl: "self-supervised learning",
  "self supervised learning": "self-supervised learning",
  peft: "parameter-efficient fine-tuning",
  "parameter efficient fine tuning": "parameter-efficient fine-tuning",
  lora: "low-rank adaptation",
  "low rank adaptation": "low-rank adaptation",
  moe: "mixture of experts",
  "mixture of experts": "mixture of experts",
  slam: "slam",
  "simultaneous localization and mapping": "slam",
  vo: "visual odometry",
  "visual odometry": "visual odometry",
  sfm: "structure from motion",
  "structure from motion": "structure from motion",
  "3d reconstruction": "3d reconstruction",
  "robot manipulation": "robotic manipulation",
  "robotic manipulation": "robotic manipulation",
  manipulation: "robotic manipulation",
  "foundation model": "foundation model",
  "world model": "world model",
  "human pose estimation": "pose estimation",
  "pose estimation": "pose estimation",
  multimodal: "multimodal",
  "multi modal": "multimodal",
  "multimodal learning": "multimodal",
  finetuning: "fine-tuning",
  "fine tuning": "fine-tuning",
  "knowledge distillation": "knowledge distillation",
  distillation: "knowledge distillation",
  transformer: "transformer",
  transformers: "transformer",
  "diffusion policy": "diffusion policy",
  "diffusion model": "diffusion model",
  "robot learning": "robot learning",
  embodied: "embodied ai",
  "embodied ai": "embodied ai",
  "embodied intelligence": "embodied ai",
};

// Tag vocabulary is small and finite; memoize the regex-heavy normalization.
const canonicalCache = new Map<string, string>();

/** Normalize a raw tag and resolve it to its canonical form. */
export function canonicalTag(raw: string): string {
  const hit = canonicalCache.get(raw);
  if (hit !== undefined) return hit;
  const result = computeCanonical(raw);
  canonicalCache.set(raw, result);
  return result;
}

function computeCanonical(raw: string): string {
  const key = raw
    .toLowerCase()
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (ALIASES[key]) return ALIASES[key];
  // light plural folding for single words (cars -> car), not for "ss" endings
  if (!key.includes(" ") && key.length > 4 && key.endsWith("s") && !key.endsWith("ss")) {
    const sing = key.slice(0, -1);
    if (ALIASES[sing]) return ALIASES[sing];
    return sing;
  }
  return key;
}

/** Canonical concept tags for a paper, used for linking and relatedness. */
export function paperTags(p: Paper): Set<string> {
  const idx = p.index;
  const out = new Set<string>();
  if (!idx) return out;
  const source = idx.tags && idx.tags.length > 0 ? idx.tags : [...idx.keywords, ...idx.topics, ...idx.methods];
  for (const raw of source) {
    const c = canonicalTag(raw);
    if (c.length > 2 && !STOP.has(c)) out.add(c);
  }
  return out;
}
