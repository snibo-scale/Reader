import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsLib } from "../lib/pdf";
import type { Tint } from "../lib/tints";
import type { Highlight, Rect } from "../types";

// Merge per-line / overlapping client-rects into one clean band per line, so
// highlights render as continuous marker strokes instead of ragged stacked boxes.
function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(r.y - last.y) < last.h * 0.6 && r.x <= last.x + last.w + 0.01) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      last.x = Math.min(last.x, r.x);
      last.w = right - last.x;
      last.y = Math.min(last.y, r.y);
      last.h = Math.max(last.h, r.h);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  tint: Tint;
  highlights: Highlight[];
  onSelectHighlight: (id: string, rect: DOMRect) => void;
  estimateW: number;
  estimateH: number;
  scrollRef: { current: HTMLElement | null };
}

function PdfPage({
  doc,
  pageNumber,
  scale,
  tint,
  highlights,
  onSelectHighlight,
  estimateW,
  estimateH,
  scrollRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState({ w: estimateW * scale, h: estimateH * scale });

  // Only mount a page's heavy canvas/text layer when it's near the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => setVisible(entries[0].isIntersecting), {
      root: scrollRef.current ?? null,
      rootMargin: "1200px 0px",
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [scrollRef]);

  // Keep the placeholder sized while not rendered, so scroll height stays stable.
  useEffect(() => {
    if (!visible) setSize({ w: estimateW * scale, h: estimateH * scale });
  }, [visible, scale, estimateW, estimateH]);

  useEffect(() => {
    if (!visible) {
      const c = canvasRef.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      textRef.current?.replaceChildren();
      return;
    }
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel?: () => void } | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const layer = textRef.current;
      if (!canvas || !layer) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setSize({ w: viewport.width, h: viewport.height });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = page.render({ canvasContext: ctx, viewport });
      try {
        await renderTask.promise;
      } catch {
        return;
      }
      if (cancelled) return;

      const content = await page.getTextContent();
      if (cancelled) return;
      layer.replaceChildren();
      layer.style.width = `${viewport.width}px`;
      layer.style.height = `${viewport.height}px`;
      const util = (pdfjsLib as unknown as { Util: { transform: (a: number[], b: number[]) => number[] } }).Util;
      const targets: { span: HTMLSpanElement; width: number }[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const tx = util.transform(viewport.transform as unknown as number[], item.transform as number[]);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        if (fontHeight === 0) continue;
        const span = document.createElement("span");
        span.textContent = item.str;
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - fontHeight}px`;
        span.style.fontSize = `${fontHeight}px`;
        layer.appendChild(span);
        targets.push({ span, width: item.width * viewport.scale });
      }
      for (const { span, width } of targets) {
        const actual = span.offsetWidth;
        if (actual > 0 && width > 0) span.style.transform = `scaleX(${width / actual})`;
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [doc, pageNumber, scale, visible]);

  return (
    <div className="pdf-page" data-page={pageNumber} ref={wrapRef} style={{ width: size.w, height: size.h }}>
      <canvas ref={canvasRef} style={{ filter: tint.filter }} />
      {tint.overlay && <div className="tint-overlay" style={{ background: tint.overlay }} />}
      <div className="text-layer" ref={textRef} />
      <div className="hl-layer">
        {visible &&
          highlights.flatMap((h) =>
            mergeRects(h.rects).map((r, idx) => (
              <div
                key={`${h.id}-${idx}`}
                className={"hl" + (h.note ? " has-note" : "")}
                title={h.note ? h.note : "Click to add a note"}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                }}
                onClick={(e) => onSelectHighlight(h.id, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              />
            ))
          )}
      </div>
    </div>
  );
}

export default memo(PdfPage);
