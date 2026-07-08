import { useEffect, useRef } from "react";
import type { Highlight } from "../types";
import type { Tint } from "../lib/tints";
import Markdown from "./Markdown";

interface Props {
  text: string;
  highlights: Highlight[];
  scale: number;
  tint: Tint;
  onOpenNote: (id: string, rect: DOMRect) => void;
}

// Map a [start,end) char range (offsets into the container's text) back to a DOM
// Range by walking text nodes — the inverse of the Range.toString() counting the
// reader uses when creating a highlight, so the two stay consistent.
function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Node | null = null;
  let startOff = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (!startNode && start <= pos + len) {
      startNode = node;
      startOff = start - pos;
    }
    if (startNode && end <= pos + len) {
      const range = document.createRange();
      range.setStart(startNode, startOff);
      range.setEnd(node, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

export default function MarkdownDoc({ text, highlights, scale, tint, onOpenNote }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Paint highlights with the CSS Custom Highlight API — no overlay geometry, so
  // it survives reflow (font size / window resize) for free.
  useEffect(() => {
    const root = ref.current;
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (!root || !reg || typeof (window as { Highlight?: unknown }).Highlight !== "function") return;
    const ranges: Range[] = [];
    for (const h of highlights) {
      if (h.start == null || h.end == null) continue;
      const r = rangeFromOffsets(root, h.start, h.end);
      if (r) ranges.push(r);
    }
    const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    reg.set("reader-hl", new HighlightCtor(...ranges));
    return () => {
      reg.delete("reader-hl");
    };
  }, [text, highlights]);

  // Click inside a highlight → open its note. Highlights drawn via the Highlight
  // API aren't hit-targets, so resolve the click to a char offset and test ranges.
  const onClick = (e: React.MouseEvent) => {
    const root = ref.current;
    const caret = (document as unknown as {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (!root || !caret) return;
    const pre = caret.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(caret.startContainer, caret.startOffset);
    const pos = pre.toString().length;
    const hit = highlights.find((h) => h.start != null && h.end != null && pos >= h.start && pos < h.end);
    if (hit) onOpenNote(hit.id, new DOMRect(e.clientX, e.clientY, 0, 0));
  };

  return (
    <div
      className="md-doc"
      ref={ref}
      style={{ fontSize: `${scale}rem`, ...(tint.overlay && { background: tint.overlay }) }}
      onClick={onClick}
      onErrorCapture={(e) => {
        // Images that fail to load (relative/hotlink-blocked/stripped embeds)
        // leave an ugly broken-image box — hide them.
        const t = e.target as HTMLElement;
        if (t.tagName === "IMG") t.style.display = "none";
      }}
    >
      <Markdown raw>{text}</Markdown>
    </div>
  );
}
