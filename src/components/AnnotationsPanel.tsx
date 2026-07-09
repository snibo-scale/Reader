import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Highlight, Paper } from "../types";
import { removeHighlight, setHighlightNote } from "../lib/util";
import NoteEditor from "./NoteEditor";

interface Props {
  paper: Paper;
  docText: string;
  onChange: (p: Paper) => void;
  onClose: () => void;
  onJump: (page: number) => void;
}

// Characters of context to show on each side of the highlight when adjusting —
// enough to complete the surrounding sentence/line.
const PAD = 140;

// Find a highlight's text in the document. The captured selection and the
// extracted document text disagree on whitespace (line wraps, column gaps,
// double spaces), so match with all whitespace stripped and map the hit back to
// the original character indices.
export function locate(docText: string, target: string): { a: number; b: number } | null {
  const needle = target.replace(/\s+/g, "");
  if (!needle || !docText) return null;
  let stripped = "";
  const map: number[] = []; // stripped index -> original index
  for (let i = 0; i < docText.length; i++) {
    if (!/\s/.test(docText[i])) {
      stripped += docText[i];
      map.push(i);
    }
  }
  const pos = stripped.indexOf(needle);
  if (pos < 0) return null;
  return { a: map[pos], b: map[pos + needle.length - 1] + 1 };
}

/**
 * One annotation. A quick tap jumps to it; press-and-hold expands it into an
 * editor showing the surrounding document text, with draggable handles at each
 * end so you can pull in letters the selection clipped. Adjusting rewrites the
 * saved annotation text only (the on-page highlight box is unaffected).
 */
function QuoteRow({
  h,
  num,
  docText,
  onJump,
  onSetText,
}: {
  h: Highlight;
  num: number;
  docText: string;
  onJump: (page: number) => void;
  onSetText: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rng, setRng] = useState<{ a: number; b: number } | null>(null);
  // The context window shown while editing; frozen when the editor opens so the
  // body text never reflows as you drag.
  const [win, setWin] = useState<{ a: number; b: number } | null>(null);
  const [drag, setDrag] = useState<"start" | "end" | null>(null);
  const rngRef = useRef(rng);
  rngRef.current = rng;
  const winRef = useRef(win);
  winRef.current = win;
  const commitRef = useRef(onSetText);
  commitRef.current = onSetText;
  const editorRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLSpanElement>(null);
  const endHandleRef = useRef<HTMLSpanElement>(null);

  // Position the overlay handles at the edges of the highlighted run. Overlays
  // (not inline elements) so moving them doesn't shift the surrounding text.
  useLayoutEffect(() => {
    const box = editorRef.current;
    if (!editing || !rng || !box) return;
    const sEl = box.querySelector<HTMLElement>(`[data-i="${rng.a}"]`);
    const eEl = box.querySelector<HTMLElement>(`[data-i="${rng.b - 1}"]`);
    const place = (el: HTMLElement | null, handle: HTMLElement | null, atEnd: boolean) => {
      if (!el || !handle) return;
      handle.style.left = `${el.offsetLeft + (atEnd ? el.offsetWidth : 0)}px`;
      handle.style.top = `${el.offsetTop}px`;
      handle.style.height = `${el.offsetHeight}px`;
    };
    place(sEl, startHandleRef.current, false);
    place(eEl, endHandleRef.current, true);
  }, [editing, rng]);

  // Center the highlighted run in the scrollable context when the editor opens.
  useEffect(() => {
    if (!editing) return;
    const box = editorRef.current;
    const hl = box?.querySelector<HTMLElement>(".sel");
    if (box && hl) box.scrollTop = hl.offsetTop - box.clientHeight / 2;
  }, [editing]);

  // A single click jumps; a double click opens the adjuster. Delay the jump so a
  // double click doesn't also fire it.
  const clickRef = useRef<number | undefined>(undefined);
  const onClick = () => {
    if (editing) return;
    if (clickRef.current) clearTimeout(clickRef.current);
    clickRef.current = window.setTimeout(() => {
      clickRef.current = undefined;
      onJump(h.page);
    }, 220);
  };
  const onDoubleClick = () => {
    if (clickRef.current) {
      clearTimeout(clickRef.current);
      clickRef.current = undefined;
    }
    const loc = locate(docText, h.text);
    if (loc) {
      setRng(loc);
      setWin({ a: Math.max(0, loc.a - PAD), b: Math.min(docText.length, loc.b + PAD) });
      setEditing(true);
    }
  };

  // While a handle is held, map the pointer to the nearest character. Use
  // caretRangeFromPoint (not elementFromPoint) so the handle sitting under the
  // cursor doesn't block the hit test.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const caret = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY) as Range | undefined;
      const node = caret?.startContainer ?? null;
      const el = node ? (node.nodeType === 3 ? node.parentElement : (node as HTMLElement)) : null;
      const charEl = el?.closest<HTMLElement>("[data-i]");
      if (!charEl) return;
      const idx = Number(charEl.dataset.i);
      const r = rngRef.current;
      const w = winRef.current;
      if (!r || !w) return;
      // Free adjustment within the frozen window — extend or trim either end.
      const next =
        drag === "start"
          ? { ...r, a: Math.min(Math.max(idx, w.a), r.b - 1) }
          : { ...r, b: Math.max(Math.min(idx + 1, w.b), r.a + 1) };
      rngRef.current = next;
      setRng(next);
    };
    const up = () => {
      setDrag(null);
      const r = rngRef.current;
      if (r) commitRef.current(docText.slice(r.a, r.b).replace(/\s+/g, " ").trim());
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, docText]);

  if (editing && rng && win) {
    const grab = (side: "start" | "end") => (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag(side);
    };
    const nodes: React.ReactNode[] = [];
    for (let i = win.a; i < win.b; i++) {
      const inHl = i >= rng.a && i < rng.b;
      nodes.push(
        <span key={i} data-i={i} className={inHl ? "annot-ch sel" : "annot-ch"}>
          {docText[i]}
        </span>
      );
    }
    return (
      <div className="annot-quote editing">
        <span className="annot-num">{num}</span>
        <div className="annot-editor" ref={editorRef}>
          {nodes}
          <span ref={startHandleRef} className="annot-handle" onPointerDown={grab("start")} />
          <span ref={endHandleRef} className="annot-handle" onPointerDown={grab("end")} />
        </div>
        <button className="annot-done" onClick={() => setEditing(false)} title="Done adjusting">
          ✓
        </button>
      </div>
    );
  }

  return (
    <div
      className="annot-quote"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title="Click to jump · double-click to adjust"
    >
      <span className="annot-num">{num}</span>
      <span className="annot-text">{h.text}</span>
    </div>
  );
}

export default function AnnotationsPanel({ paper, docText, onChange, onClose, onJump }: Props) {
  const sorted = [...paper.highlights].sort((a, b) => a.page - b.page);
  const setNote = (hid: string, note: string) => onChange(setHighlightNote(paper, hid, note));
  const setText = (hid: string, text: string) =>
    onChange({ ...paper, highlights: paper.highlights.map((x) => (x.id === hid ? { ...x, text } : x)) });
  const remove = (hid: string) => onChange(removeHighlight(paper, hid));
  const setNotes = (notes: string) => onChange({ ...paper, notes });

  return (
    <div className="annot-panel">
      <div className="annot-head">
        <span>Annotations {sorted.length > 0 && <span className="annot-count">{sorted.length}</span>}</span>
        <button className="refs-mini" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="annot-notes">
        <div className="annot-notes-label">Notes</div>
        <NoteEditor
          key={paper.id}
          className="annot-notes-area"
          placeholder="General notes on this paper…"
          initial={paper.notes ?? ""}
          onCommit={setNotes}
        />
      </div>

      {sorted.length === 0 ? (
        <div className="refs-status">No highlights yet. Select text in the PDF and choose Highlight.</div>
      ) : (
        <div className="annot-list">
          {sorted.map((h, i) => (
            <div key={h.id} className="annot">
              <QuoteRow h={h} num={i + 1} docText={docText} onJump={onJump} onSetText={(t) => setText(h.id, t)} />
              <div className="annot-meta">
                Annotation <span className="sep">/</span> Page {h.page}
                <button className="annot-del" onClick={() => remove(h.id)}>
                  Delete
                </button>
              </div>
              <NoteEditor
                key={h.id}
                className="annot-comment"
                placeholder="Your comment"
                initial={h.note ?? ""}
                onCommit={(note) => setNote(h.id, note)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
