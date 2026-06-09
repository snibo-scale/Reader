export interface Tint {
  id: string;
  /** Color multiplied over the white page (keeps black text readable). */
  overlay?: string;
  /** CSS filter applied to the canvas (used for dark mode). */
  filter?: string;
}

export type TintMode = "white" | "color" | "dark";

export interface TintColor {
  h: number; // 0–360
  s: number; // 0–100
  l: number; // 0–100
}

export const DEFAULT_TINT_COLOR: TintColor = { h: 45, s: 45, l: 88 };

export function hslString(c: TintColor): string {
  return `hsl(${c.h}, ${c.s}%, ${c.l}%)`;
}

export const WHITE: Tint = { id: "white" };
export const DARK: Tint = { id: "dark", filter: "invert(0.9) hue-rotate(180deg)" };

export function resolveTint(mode: TintMode, color: TintColor): Tint {
  if (mode === "dark") return DARK;
  if (mode === "color") return { id: "color", overlay: hslString(color) };
  return WHITE;
}
