import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { openUrl } from "@tauri-apps/plugin-opener";
import { pdfjsLib } from "../lib/pdf";
import type { Tint } from "../lib/tints";
import type { Highlight, Rect } from "../types";

// WKWebView silently breaks canvases past ~16.7M device pixels (letter page at
// 300% on a retina display). Like pdf.js's maxCanvasPixels, render smaller than
// that and let CSS upscale the rest.
const MAX_CANVAS_PX = 2 ** 24;
// Zoom (pdf.js "drawingDelay"): CSS-stretch the current bitmap at once and only
// re-render once the scale has held still this long, so pinch-zoom is one draw
// per gesture instead of one per wheel tick.
const REDRAW_DELAY = 150;

// Resolve a PDF link's internal destination to a page number + vertical fraction.
// dest is either a named string or an explicit array [pageRef, {name}, ...coords].
async function resolveDest(
  doc: PDFDocumentProxy,
  dest: unknown
): Promise<{ page: number; yFrac: number } | null> {
  const arr = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(arr) || !arr[0]) return null;
  const idx = await doc.getPageIndex(arr[0] as never); // 0-based
  const page = await doc.getPage(idx + 1);
  const height = page.getViewport({ scale: 1 }).viewBox[3];
  // /XYZ keeps top at arr[3]; /FitH & /FitBH keep it at arr[2]. y is from page bottom.
  const mode = (arr[1] as { name?: string } | undefined)?.name;
  const top = mode === "XYZ" ? arr[3] : mode === "FitH" || mode === "FitBH" ? arr[2] : null;
  const yFrac = typeof top === "number" && height ? Math.max(0, Math.min(1, 1 - top / height)) : 0;
  return { page: idx + 1, yFrac };
}

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
  onJump: (page: number, yFrac: number) => void;
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
  onJump,
}: Props) {
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState({ w: estimateW * scale, h: estimateH * scale });
  const pageRef = useRef<PDFPageProxy | null>(null);
  const textLayerRef = useRef<InstanceType<typeof pdfjsLib.TextLayer> | null>(null);
  const cancelDrawRef = useRef<(() => void) | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

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

  // Paint the page into a fresh canvas and swap it in only once complete, so the
  // previous bitmap stays on screen (CSS-stretched) instead of flashing blank.
  const draw = (page: PDFPageProxy) => {
    cancelDrawRef.current?.();
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const viewport = page.getViewport({ scale: scaleRef.current });
    const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PX / (viewport.width * viewport.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport });
    let done = false;
    cancelDrawRef.current = () => {
      if (!done) task.cancel();
    };
    task.promise.then(
      () => {
        done = true;
        const cur = page.getViewport({ scale: scaleRef.current });
        canvas.style.width = `${cur.width}px`;
        canvas.style.height = `${cur.height}px`;
        wrap.replaceChildren(canvas);
      },
      () => {}
    );
  };

  // Mount: fetch the page once, draw it, and build the text + link layers. Both
  // layers are laid out in page-relative units (%, --scale-factor), so zooming
  // never rebuilds them.
  useEffect(() => {
    if (!visible) {
      cancelDrawRef.current?.();
      textLayerRef.current?.cancel();
      textLayerRef.current = null;
      pageRef.current = null;
      canvasWrapRef.current?.replaceChildren();
      textRef.current?.replaceChildren();
      linkRef.current?.replaceChildren();
      return;
    }
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      pageRef.current = page;
      const viewport = page.getViewport({ scale: scaleRef.current });
      setSize({ w: viewport.width, h: viewport.height });
      draw(page);

      const layer = textRef.current;
      if (layer) {
        layer.replaceChildren();
        const tl = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        textLayerRef.current = tl;
        tl.render().catch(() => {});
      }

      // Link layer: make embedded PDF hyperlinks (external URLs) and GoTo
      // destinations (settings/section jumps) clickable over the page.
      const annots = await page.getAnnotations();
      if (cancelled) return;
      const links = linkRef.current;
      if (!links) return;
      links.replaceChildren();
      for (const a of annots) {
        if (a.subtype !== "Link") continue;
        const url: string | undefined = a.url || a.unsafeUrl;
        if (!url && !a.dest) continue;
        const [rx1, ry1, rx2, ry2] = viewport.convertToViewportRectangle(a.rect);
        const el = document.createElement("a");
        el.className = "pdf-link";
        el.style.left = `${(Math.min(rx1, rx2) / viewport.width) * 100}%`;
        el.style.top = `${(Math.min(ry1, ry2) / viewport.height) * 100}%`;
        el.style.width = `${(Math.abs(rx2 - rx1) / viewport.width) * 100}%`;
        el.style.height = `${(Math.abs(ry2 - ry1) / viewport.height) * 100}%`;
        if (url && /^(https?:|mailto:)/i.test(url)) {
          el.href = url;
          el.title = url;
          el.onclick = (e) => {
            e.preventDefault();
            openUrl(url);
          };
        } else if (a.dest) {
          el.onclick = (e) => {
            e.preventDefault();
            resolveDest(doc, a.dest).then((d) => d && onJumpRef.current(d.page, d.yFrac));
          };
        }
        links.appendChild(el);
      }
    })();

    return () => {
      cancelled = true;
      cancelDrawRef.current?.();
      textLayerRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, visible]);

  // Zoom: resize the box and CSS-stretch the current bitmap immediately, then
  // re-render sharp after the scale settles.
  useEffect(() => {
    const page = pageRef.current;
    if (!visible || !page) return;
    const viewport = page.getViewport({ scale });
    setSize({ w: viewport.width, h: viewport.height });
    for (const c of Array.from(canvasWrapRef.current?.children ?? [])) {
      (c as HTMLElement).style.width = `${viewport.width}px`;
      (c as HTMLElement).style.height = `${viewport.height}px`;
    }
    textLayerRef.current?.update({ viewport });
    const t = setTimeout(() => draw(page), REDRAW_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, visible]);

  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      ref={wrapRef}
      style={{ width: size.w, height: size.h, "--scale-factor": scale } as CSSProperties}
    >
      <div className="canvas-layer" ref={canvasWrapRef} style={{ filter: tint.filter }} />
      {tint.overlay && <div className="tint-overlay" style={{ background: tint.overlay }} />}
      <div className="text-layer" ref={textRef} />
      <div className="link-layer" ref={linkRef} />
      <div className="hl-layer">
        {visible &&
          highlights.flatMap((h) =>
            mergeRects(h.rects).map((r, idx) => (
              <div
                key={`${h.id}-${idx}`}
                className={"hl" + (h.note ? " has-note" : "")}
                title={h.note ? undefined : "Click to add a note"}
                data-note={h.note || undefined}
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
