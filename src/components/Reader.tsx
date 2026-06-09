import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight, Paper, Rect } from "../types";
import { extractReferences, readPdfBytes } from "../lib/api";
import { extractTailText, extractText, loadPdf } from "../lib/pdf";
import { uid } from "../lib/util";
import { DEFAULT_TINT_COLOR, resolveTint, type TintColor, type TintMode } from "../lib/tints";
import TintPicker from "./TintPicker";
import { parseReferences } from "../lib/metadata";
import { getModel, getProvider } from "../lib/settings";
import PdfPage from "./PdfPage";
import ChatPanel from "./ChatPanel";
import RelatedCard from "./RelatedCard";
import ReferencesPanel from "./ReferencesPanel";
import Presentation, { type Slide } from "./Presentation";
import NoteEditor from "./NoteEditor";
import AnnotationsPanel from "./AnnotationsPanel";

const HL_COLOR = "#f2c94c";
const NO_HIGHLIGHTS: Highlight[] = [];

interface Props {
  paper: Paper;
  papers: Paper[];
  indexing: boolean;
  onBack: () => void;
  onChange: (p: Paper) => void;
  onOpenPaper: (id: string) => void;
  onImported: (p: Paper) => void;
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

export default function Reader({ paper, papers, indexing, onBack, onChange, onOpenPaper, onImported }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [base, setBase] = useState({ w: 612, h: 792 });
  const [scale, setScale] = useState(1.4);
  const [paperText, setPaperText] = useState("");
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [rightPanel, setRightPanel] = useState<"none" | "chat" | "refs" | "notes">("none");
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
  const [refsBusy, setRefsBusy] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [activeNote, setActiveNote] = useState<{ id: string; top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const slides: Slide[] = useMemo(
    () =>
      [...paper.highlights]
        .sort((a, b) => a.page - b.page)
        .map((h) => ({ paperId: paper.id, paperTitle: paper.title, highlight: h })),
    [paper.highlights, paper.id, paper.title]
  );
  const setNote = useCallback(
    (_pid: string, hid: string, note: string) =>
      onChange({ ...paper, highlights: paper.highlights.map((h) => (h.id === hid ? { ...h, note } : h)) }),
    [paper, onChange]
  );

  // Manual (re-)extraction, e.g. the panel's ↻ button or when a paper was
  // indexed before references existed and auto-extraction hasn't run.
  const reExtractRefs = useCallback(async () => {
    if (!doc) return;
    setRefsBusy(true);
    try {
      const tail = await extractTailText(doc);
      onChange({ ...paper, references: parseReferences(await extractReferences(tail, getProvider(), getModel())) });
    } catch {
      /* keep prior references */
    } finally {
      setRefsBusy(false);
    }
  }, [doc, paper, onChange]);

  const togglePanel = useCallback((p: "chat" | "refs" | "notes") => {
    setRightPanel((cur) => (cur === p ? "none" : p));
  }, []);
  const jumpToPage = useCallback((page: number) => {
    containerRef.current
      ?.querySelector(`.pdf-page[data-page="${page}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const tint = useMemo(() => resolveTint(tintMode, tintColor), [tintMode, tintColor]);
  const hlByPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of paper.highlights) m.set(h.page, [...(m.get(h.page) ?? []), h]);
    return m;
  }, [paper.highlights]);
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
      d.getPage(1).then((p) => {
        if (cancelled) return;
        const v = p.getViewport({ scale: 1 });
        setBase({ w: v.width, h: v.height });
      });
      extractText(d).then((t) => {
        if (!cancelled) setPaperText(t);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [paper.id]);

  // Indexing (analysis + references) runs in the background from App, so it keeps
  // going and persists even if this reader is closed. `indexing` reflects its status.

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
    setRightPanel("chat");
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, [selection]);

  const removeHighlight = useCallback(
    (id: string) => {
      onChange({ ...paper, highlights: paper.highlights.filter((h) => h.id !== id) });
    },
    [paper, onChange]
  );

  const handleSelectHighlight = useCallback((id: string, rect: DOMRect) => {
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 290));
    setActiveNote({ id, top: rect.bottom + 6, left });
  }, []);

  return (
    <div className="reader">
      <header className="reader-header">
        <div className="crumbs">
          <button className="link" onClick={onBack}>
            My Library
          </button>
          <span className="sep">/</span>
          <strong>{paper.title}</strong>
          {indexing && <span className="meta-busy">· indexing paper…</span>}
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
          <button
            className="toggle"
            onClick={() => setPresenting(true)}
            disabled={paper.highlights.length === 0}
            title="Present highlights"
          >
            ▶ Present
          </button>
          <button
            className={"toggle" + (rightPanel === "notes" ? " current" : "")}
            onClick={() => togglePanel("notes")}
          >
            ✎ Notes
          </button>
          <button
            className={"toggle" + (rightPanel === "refs" ? " current" : "")}
            onClick={() => togglePanel("refs")}
          >
            ⬇ Refs
          </button>
          <button
            className={"toggle" + (rightPanel === "chat" ? " current" : "")}
            onClick={() => togglePanel("chat")}
          >
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
                highlights={hlByPage.get(i + 1) ?? NO_HIGHLIGHTS}
                onSelectHighlight={handleSelectHighlight}
                estimateW={base.w}
                estimateH={base.h}
                scrollRef={containerRef}
              />
            ))
          ) : (
            <div className="loading">Loading PDF…</div>
          )}
        </div>

        {rightPanel === "refs" && (
          <ReferencesPanel
            refs={paper.references ?? null}
            papers={papers}
            busy={indexing || refsBusy}
            onReload={reExtractRefs}
            onClose={() => setRightPanel("none")}
            onImported={onImported}
          />
        )}

        {rightPanel === "notes" && (
          <AnnotationsPanel
            paper={paper}
            onChange={onChange}
            onClose={() => setRightPanel("none")}
            onJump={jumpToPage}
          />
        )}

        {rightPanel === "chat" && (
          <ChatPanel
            paper={paper}
            paperText={paperText}
            seedContext={askContext}
            onConsumeSeed={() => setAskContext("")}
            onChange={onChange}
          />
        )}
      </div>

      {presenting && (
        <Presentation slides={slides} onClose={() => setPresenting(false)} onUpdateNote={setNote} />
      )}

      {activeNote &&
        (() => {
          const h = paper.highlights.find((x) => x.id === activeNote.id);
          if (!h) return null;
          return (
            <>
              <div className="note-backdrop" onClick={() => setActiveNote(null)} />
              <div className="note-pop" style={{ top: activeNote.top, left: activeNote.left }}>
                <NoteEditor
                  key={h.id}
                  autoFocus
                  className="note-pop-text"
                  placeholder="Add a note…"
                  initial={h.note ?? ""}
                  onCommit={(note) => setNote(paper.id, h.id, note)}
                />
                <div className="note-pop-actions">
                  <button
                    className="note-remove"
                    onClick={() => {
                      removeHighlight(h.id);
                      setActiveNote(null);
                    }}
                  >
                    Remove
                  </button>
                  <button className="note-done" onClick={() => setActiveNote(null)}>
                    Done
                  </button>
                </div>
              </div>
            </>
          );
        })()}

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
