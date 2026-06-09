import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsLib } from "../lib/pdf";
import type { Tint } from "../lib/tints";
import type { Highlight } from "../types";

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  tint: Tint;
  highlights: Highlight[];
  onRemoveHighlight: (id: string) => void;
}

export default function PdfPage({ doc, pageNumber, scale, tint, highlights, onRemoveHighlight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderTask: any = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const layer = textRef.current;
      if (!canvas || !wrap || !layer) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      wrap.style.width = `${viewport.width}px`;
      wrap.style.height = `${viewport.height}px`;
      layer.style.width = `${viewport.width}px`;
      layer.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = page.render({ canvasContext: ctx, viewport });
      try {
        await renderTask.promise;
      } catch {
        return; // render cancelled
      }
      if (cancelled) return;

      // Build a selectable transparent text layer aligned over the canvas.
      const content = await page.getTextContent();
      if (cancelled) return;
      layer.replaceChildren();
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

      // Second pass: horizontally scale each span to match the glyph run width.
      for (const { span, width } of targets) {
        const actual = span.offsetWidth;
        if (actual > 0 && width > 0) {
          span.style.transform = `scaleX(${width / actual})`;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask && typeof renderTask.cancel === "function") renderTask.cancel();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div className="pdf-page" data-page={pageNumber} ref={wrapRef}>
      <canvas ref={canvasRef} style={{ filter: tint.filter }} />
      {tint.overlay && (
        <div className="tint-overlay" style={{ background: tint.overlay }} />
      )}
      <div className="text-layer" ref={textRef} />
      <div className="hl-layer">
        {highlights.flatMap((h) =>
          h.rects.map((r, idx) => (
            <div
              key={`${h.id}-${idx}`}
              className="hl"
              title={h.note ? h.note : "Click to remove highlight"}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                background: h.color,
              }}
              onClick={() => onRemoveHighlight(h.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
