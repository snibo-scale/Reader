import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Highlight, Paper, ReadingList, Rect } from "../types";
import { analyzePaper, extractReferences, readPdfBytes } from "../lib/api";
import { extractTailText, extractText, loadPdf } from "../lib/pdf";
import { removeHighlight as withoutHighlight, setHighlightNote, uid } from "../lib/util";
import { DEFAULT_TINT_COLOR, resolveTint, type TintColor, type TintMode } from "../lib/tints";
import TintPicker from "./TintPicker";
import { parseAnalysis, parseReferences } from "../lib/metadata";
import { applyAnalysis } from "../lib/indexer";
import { getModel, getProvider } from "../lib/settings";
import PdfPage from "./PdfPage";
import ChatPanel from "./ChatPanel";
import RelatedCard from "./RelatedCard";
import ReferencesPanel from "./ReferencesPanel";
import SummaryPanel from "./SummaryPanel";
import Presentation, { paperSlides } from "./Presentation";
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
  lists: ReadingList[];
  onChangeLists: (next: ReadingList[]) => void;
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

// Reconstruct the selected text directly from the text-layer spans that fall
// under the selection, ordered by visual position. WebKit's Selection.toString()
// walks the DOM and drops/merges content across the absolutely-positioned spans
// of our custom text layer, so the saved quote can miss text even when the
// highlight bands look right. Reading the geometry keeps text and highlight in sync.
function selectionTextFromGeometry(range: Range, layer: HTMLElement): string {
  const selRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  if (!selRects.length) return "";

  type Frag = { x: number; y: number; right: number; h: number; text: string };
  const frags: Frag[] = [];
  for (const span of Array.from(layer.querySelectorAll<HTMLSpanElement>("span"))) {
    const sr = span.getBoundingClientRect();
    if (sr.width === 0 || sr.height === 0) continue;
    const cy = sr.top + sr.height / 2;
    // Include a span only when its vertical center lands inside a selection rect
    // (same line — no bleed onto the line above/below) AND most of its width is
    // horizontally within the selection (so grazed boundary words aren't pulled in).
    const onSelection = selRects.some((r) => {
      if (cy < r.top || cy > r.bottom) return false;
      const ox = Math.max(0, Math.min(sr.right, r.right) - Math.max(sr.left, r.left));
      return ox >= sr.width * 0.5;
    });
    if (!onSelection) continue;
    frags.push({ x: sr.left, y: sr.top, right: sr.right, h: sr.height, text: span.textContent ?? "" });
  }

  frags.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.5 ? a.y - b.y : a.x - b.x));

  let out = "";
  let prev: Frag | null = null;
  for (const f of frags) {
    if (prev) {
      const newLine = f.y - prev.y > Math.min(prev.h, f.h) * 0.5;
      const gap = f.x - prev.right > f.h * 0.2;
      if ((newLine || gap) && !out.endsWith(" ")) out += " ";
    }
    out += f.text;
    prev = f;
  }
  return out.replace(/\s+/g, " ").trim();
}

export default function Reader({ paper, papers, indexing, onBack, onChange, onOpenPaper, onImported, lists, onChangeLists }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [base, setBase] = useState({ w: 612, h: 792 });
  const [scale, setScale] = useState(1.4);
  const [paperText, setPaperText] = useState("");
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [rightPanel, setRightPanel] = useState<"none" | "chat" | "refs" | "notes" | "summary">("none");
  const [summaryBusy, setSummaryBusy] = useState(false);
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
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const listWrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const inAnyList = lists.some((l) => l.paperIds.includes(paper.id));

  const toggleInList = useCallback(
    (listId: string) => {
      onChangeLists(
        lists.map((l) => {
          if (l.id !== listId) return l;
          const has = l.paperIds.includes(paper.id);
          return {
            ...l,
            paperIds: has ? l.paperIds.filter((id) => id !== paper.id) : [...l.paperIds, paper.id],
          };
        })
      );
    },
    [lists, paper.id, onChangeLists]
  );

  const createListWith = useCallback(() => {
    const name = newListName.trim();
    if (!name) return;
    const list: ReadingList = {
      id: crypto.randomUUID(),
      name,
      paperIds: [paper.id],
      createdAt: new Date().toISOString(),
    };
    onChangeLists([...lists, list]);
    setNewListName("");
  }, [newListName, lists, paper.id, onChangeLists]);

  // Close the list menu on an outside click or Escape.
  useEffect(() => {
    if (!listMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (listWrapRef.current && !listWrapRef.current.contains(e.target as Node)) {
        setListMenuOpen(false);
        setNewListName("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setListMenuOpen(false);
        setNewListName("");
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [listMenuOpen]);

  const slides = useMemo(() => paperSlides(paper), [paper]);
  const setNote = useCallback(
    (_pid: string, hid: string, note: string) => onChange(setHighlightNote(paper, hid, note)),
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

  const togglePanel = useCallback((p: "chat" | "refs" | "notes" | "summary") => {
    setRightPanel((cur) => (cur === p ? "none" : p));
  }, []);

  // Re-run analysis on demand (e.g. after editing the indexing prompt in Settings).
  // Indexing also runs automatically in the background on open, so this is the
  // manual path; the generated summary lands on paper.index.summary.
  const regenerateSummary = useCallback(async () => {
    if (!paperText.trim() || summaryBusy) return;
    setSummaryBusy(true);
    try {
      const a = parseAnalysis(await analyzePaper(paperText, getProvider(), getModel()));
      if (a) onChange(applyAnalysis(paper, a));
    } catch {
      /* keep the existing summary */
    } finally {
      setSummaryBusy(false);
    }
  }, [paperText, summaryBusy, paper, onChange]);
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
    const rawText = sel.toString().trim();
    const anchor = sel.anchorNode;
    if (!rawText || !anchor || !containerRef.current?.contains(anchor)) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const box = range.getBoundingClientRect();

    let pending: PendingHighlight | null = null;
    let text = rawText;
    const anchorEl = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
    const pageEl = anchorEl?.closest(".pdf-page") as HTMLElement | null;
    if (pageEl?.dataset.page) {
      const layer = pageEl.querySelector<HTMLElement>(".text-layer");
      // Prefer geometry-reconstructed text; fall back to the raw selection string.
      if (layer) text = selectionTextFromGeometry(range, layer) || rawText;
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
    (id: string) => onChange(withoutHighlight(paper, id)),
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
          <span className="bar-divider" />
          <div className="card-list-wrap reader-list-wrap" ref={listWrapRef}>
            <button
              className={"toggle" + (inAnyList ? " current" : "")}
              onClick={() => setListMenuOpen((o) => !o)}
              title={inAnyList ? "In a reading list" : "Add to a reading list"}
            >
              {inAnyList ? "★" : "⊕"}
            </button>
            {listMenuOpen && (
              <div className="list-menu" onClick={(e) => e.stopPropagation()}>
                <div className="list-menu-title">Add to list</div>
                {lists.length === 0 && <div className="list-menu-empty">No lists yet</div>}
                {lists.map((l) => {
                  const has = l.paperIds.includes(paper.id);
                  return (
                    <button key={l.id} className="list-menu-item" onClick={() => toggleInList(l.id)}>
                      <span className="list-menu-check">{has ? "✓" : ""}</span>
                      <span className="list-menu-name">{l.name}</span>
                    </button>
                  );
                })}
                <div className="list-menu-new">
                  <input
                    value={newListName}
                    placeholder="New list…"
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createListWith();
                      if (e.key === "Escape") {
                        setListMenuOpen(false);
                        setNewListName("");
                      }
                    }}
                  />
                  <button onClick={createListWith} disabled={!newListName.trim()}>
                    +
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            className={"toggle" + (paper.readAt ? " current" : "")}
            onClick={() => onChange({ ...paper, readAt: paper.readAt ? null : new Date().toISOString() })}
            title={paper.readAt ? "Marked read — click to unmark" : "Mark as read"}
          >
            {paper.readAt ? "✓" : "○"}
          </button>
          <button
            className="toggle"
            onClick={() => setPresenting(true)}
            disabled={paper.highlights.length === 0}
            title="Present highlights"
          >
            ▶
          </button>
          <span className="bar-divider" />
          <button
            className={"toggle" + (rightPanel === "notes" ? " current" : "")}
            onClick={() => togglePanel("notes")}
            title="Notes &amp; annotations"
          >
            ✎
          </button>
          <button
            className={"toggle" + (rightPanel === "summary" ? " current" : "")}
            onClick={() => togglePanel("summary")}
            title="Paper summary"
          >
            ❝
          </button>
          <button
            className={"toggle" + (rightPanel === "refs" ? " current" : "")}
            onClick={() => togglePanel("refs")}
            title="References"
          >
            ⬇
          </button>
          <button
            className={"toggle" + (rightPanel === "chat" ? " current" : "")}
            onClick={() => togglePanel("chat")}
            title="Ask AI"
          >
            ✦
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

        {rightPanel === "summary" && (
          <SummaryPanel
            paper={paper}
            busy={summaryBusy || indexing}
            onRegenerate={regenerateSummary}
            onClose={() => setRightPanel("none")}
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
                  onSubmit={() => setActiveNote(null)}
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
