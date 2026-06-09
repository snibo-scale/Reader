import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight, Paper, Rect } from "../types";
import { analyzePaper, readPdfBytes } from "../lib/api";
import { extractText, loadPdf } from "../lib/pdf";
import { uid } from "../lib/util";
import { DEFAULT_TINT_COLOR, resolveTint, type TintColor, type TintMode } from "../lib/tints";
import TintPicker from "./TintPicker";
import { parseAnalysis } from "../lib/metadata";
import { applyAnalysis, needsIndexing } from "../lib/indexer";
import { getModel, getProvider } from "../lib/settings";
import PdfPage from "./PdfPage";
import ChatPanel from "./ChatPanel";
import RelatedCard from "./RelatedCard";

const HL_COLOR = "rgba(255, 222, 89, 0.45)";

interface Props {
  paper: Paper;
  papers: Paper[];
  onBack: () => void;
  onChange: (p: Paper) => void;
  onOpenPaper: (id: string) => void;
}

interface PendingHighlight {
  page: number;
  text: string;
  rects: Rect[];
}

interface SelectionState {
  text: string;
  top: number;
  left: number;
  pending: PendingHighlight | null;
}

export default function Reader({ paper, papers, onBack, onChange, onOpenPaper }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.4);
  const [paperText, setPaperText] = useState("");
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [askContext, setAskContext] = useState("");
  const [tintMode, setTintMode] = useState<TintMode>(
    () => (localStorage.getItem("reader.tintMode") as TintMode) ?? "white"
  );
  const [tintColor, setTintColor] = useState<TintColor>(() => {
    try {
      return { ...DEFAULT_TINT_COLOR, ...JSON.parse(localStorage.getItem("reader.tintColor") || "{}") };
    } catch {
      return DEFAULT_TINT_COLOR;
    }
  });
  const [metaBusy, setMetaBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const metaTried = useRef(false);

  const tint = resolveTint(tintMode, tintColor);
  useEffect(() => {
    localStorage.setItem("reader.tintMode", tintMode);
    localStorage.setItem("reader.tintColor", JSON.stringify(tintColor));
  }, [tintMode, tintColor]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bytes = await readPdfBytes(paper.id);
      const d = await loadPdf(bytes);
      if (cancelled) return;
      setDoc(d);
      setNumPages(d.numPages);
      extractText(d).then((t) => {
        if (!cancelled) setPaperText(t);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [paper.id]);

  // On first open, index the paper in the background: extract metadata AND build
  // the internal understanding (summary / topics / methods / keywords) used for
  // connections and recommendations. Runs once; re-tries next open on failure.
  const needsIndex = needsIndexing(paper);
  useEffect(() => {
    if (!needsIndex || metaTried.current || !paperText) return;
    metaTried.current = true;
    let cancelled = false;
    setMetaBusy(true);
    (async () => {
      try {
        const raw = await analyzePaper(paperText, getProvider(), getModel());
        const a = parseAnalysis(raw);
        if (!cancelled && a) onChange(applyAnalysis(paper, a));
      } catch {
        /* leave existing metadata in place; retry on next open */
      } finally {
        if (!cancelled) setMetaBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperText, needsIndex, paper, onChange]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    const anchor = sel.anchorNode;
    if (!text || !anchor || !containerRef.current?.contains(anchor)) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const box = range.getBoundingClientRect();

    let pending: PendingHighlight | null = null;
    const anchorEl = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
    const pageEl = anchorEl?.closest(".pdf-page") as HTMLElement | null;
    if (pageEl?.dataset.page) {
      const pr = pageEl.getBoundingClientRect();
      const rects: Rect[] = Array.from(range.getClientRects())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({
          x: (r.left - pr.left) / pr.width,
          y: (r.top - pr.top) / pr.height,
          w: r.width / pr.width,
          h: r.height / pr.height,
        }));
      if (rects.length) pending = { page: Number(pageEl.dataset.page), text, rects };
    }

    setSelection({ text, top: box.top - 46, left: box.left, pending });
  }, []);

  const addHighlight = useCallback(() => {
    if (!selection?.pending) return;
    const hl: Highlight = {
      ...selection.pending,
      id: uid(),
      color: HL_COLOR,
      createdAt: new Date().toISOString(),
    };
    onChange({ ...paper, highlights: [...paper.highlights, hl] });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, [selection, paper, onChange]);

  const askAboutSelection = useCallback(() => {
    if (!selection) return;
    setAskContext(selection.text);
    setChatOpen(true);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, [selection]);

  const removeHighlight = useCallback(
    (id: string) => {
      onChange({ ...paper, highlights: paper.highlights.filter((h) => h.id !== id) });
    },
    [paper, onChange]
  );

  return (
    <div className="reader">
      <header className="reader-header">
        <div className="crumbs">
          <button className="link" onClick={onBack}>
            My Library
          </button>
          <span className="sep">/</span>
          <span className="muted">{paper.category}</span>
          <span className="sep">/</span>
          <strong>{paper.title}</strong>
          {metaBusy && <span className="meta-busy">· indexing paper…</span>}
        </div>
        <div className="reader-tools">
          <TintPicker
            mode={tintMode}
            color={tintColor}
            onChange={(m, c) => {
              setTintMode(m);
              setTintColor(c);
            }}
          />
          <button onClick={() => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)))}>−</button>
          <span className="zoom">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, +(s + 0.15).toFixed(2)))}>+</button>
          <button className={"toggle" + (chatOpen ? " current" : "")} onClick={() => setChatOpen((v) => !v)}>
            ✦ AI
          </button>
        </div>
      </header>

      <div className="reader-body">
        <RelatedCard paper={paper} papers={papers} onOpen={onOpenPaper} />
        <div className={"pdf-scroll" + (tint.filter ? " dark" : "")} ref={containerRef} onMouseUp={handleMouseUp}>
          {doc ? (
            Array.from({ length: numPages }, (_, i) => (
              <PdfPage
                key={i}
                doc={doc}
                pageNumber={i + 1}
                scale={scale}
                tint={tint}
                highlights={paper.highlights.filter((h) => h.page === i + 1)}
                onRemoveHighlight={removeHighlight}
              />
            ))
          ) : (
            <div className="loading">Loading PDF…</div>
          )}
        </div>

        {chatOpen && (
          <ChatPanel
            paper={paper}
            paperText={paperText}
            seedContext={askContext}
            onConsumeSeed={() => setAskContext("")}
            onChange={onChange}
          />
        )}
      </div>

      {selection && (
        <div className="sel-toolbar" style={{ top: selection.top, left: selection.left }}>
          <button onClick={addHighlight} disabled={!selection.pending}>
            ◍ Highlight
          </button>
          <button onClick={askAboutSelection}>✦ Ask AI</button>
        </div>
      )}
    </div>
  );
}
