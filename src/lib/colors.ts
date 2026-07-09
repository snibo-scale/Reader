// Flexoki accent palette (https://stephango.com/flexoki) — light variants.
// Each tag/category maps deterministically to one accent, so its sidebar dot,
// card tint, and chips all share a color.
const FLEXOKI = [
  { solid: "#D14D41", deep: "#AF3029" }, // red
  { solid: "#DA702C", deep: "#BC5215" }, // orange
  { solid: "#D0A215", deep: "#AD8301" }, // yellow
  { solid: "#879A39", deep: "#66800B" }, // green
  { solid: "#3AA99F", deep: "#24837B" }, // cyan
  { solid: "#4385BE", deep: "#205EA6" }, // blue
  { solid: "#8B7EC8", deep: "#5E409D" }, // purple
  { solid: "#CE5D97", deep: "#A02F6F" }, // magenta
];
const PAPER = "#FFFCF0";

function hashIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

function accent(name: string) {
  return FLEXOKI[hashIndex(name.trim().toLowerCase(), FLEXOKI.length)];
}

export function tagDotColor(name: string): string {
  return accent(name).solid;
}

export function tagChipColors(name: string): { background: string; color: string } {
  const a = accent(name);
  return { background: `color-mix(in srgb, ${a.solid} 22%, ${PAPER})`, color: a.deep };
}

/** Paper card / timeline background. Classic theme = the original per-topic wash on
   cream; minimal theme = a uniform, faint silver-blue wash on white. */
export function tagTint(name: string, pct = 15): string {
  if (document.documentElement.dataset.theme === "classic") {
    return `color-mix(in srgb, ${accent(name).solid} 14%, ${PAPER})`;
  }
  return `color-mix(in srgb, var(--accent) ${pct}%, #ffffff)`;
}
