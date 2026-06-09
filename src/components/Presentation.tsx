import { useEffect, useState } from "react";
import type { Highlight } from "../types";
import NoteEditor from "./NoteEditor";

export interface Slide {
  paperId: string;
  paperTitle: string;
  highlight: Highlight;
}

interface Props {
  slides: Slide[];
  onClose: () => void;
  onUpdateNote: (paperId: string, highlightId: string, note: string) => void;
}

export default function Presentation({ slides, onClose, onUpdateNote }: Props) {
  const [i, setI] = useState(0);
  const total = slides.length;
  const cur = slides[Math.min(i, total - 1)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setI((v) => Math.min(total - 1, v + 1));
      } else if (e.key === "ArrowLeft") {
        setI((v) => Math.max(0, v - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, onClose]);

  return (
    <div className="present">
      <button className="present-close" onClick={onClose} title="Exit (Esc)">
        ✕
      </button>

      {!cur ? (
        <div className="present-empty">No highlights to present yet.</div>
      ) : (
        <>
          <div className="present-stage">
            <div className="present-paper">{cur.paperTitle}</div>
            <blockquote className="present-quote" style={{ borderColor: cur.highlight.color }}>
              {cur.highlight.text}
            </blockquote>
            <NoteEditor
              key={cur.highlight.id}
              className="present-note"
              placeholder="Add a note… (saved automatically)"
              initial={cur.highlight.note ?? ""}
              onCommit={(note) => onUpdateNote(cur.paperId, cur.highlight.id, note)}
            />
          </div>

          <div className="present-nav">
            <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
              ‹ Prev
            </button>
            <span className="present-count">
              {Math.min(i, total - 1) + 1} / {total}
              <span className="present-page"> · p.{cur.highlight.page}</span>
            </span>
            <button onClick={() => setI((v) => Math.min(total - 1, v + 1))} disabled={i >= total - 1}>
              Next ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}
