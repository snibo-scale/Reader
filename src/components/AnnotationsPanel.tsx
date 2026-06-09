import type { Paper } from "../types";
import NoteEditor from "./NoteEditor";

interface Props {
  paper: Paper;
  onChange: (p: Paper) => void;
  onClose: () => void;
  onJump: (page: number) => void;
}

export default function AnnotationsPanel({ paper, onChange, onClose, onJump }: Props) {
  const sorted = [...paper.highlights].sort((a, b) => a.page - b.page);
  const setNote = (hid: string, note: string) =>
    onChange({ ...paper, highlights: paper.highlights.map((h) => (h.id === hid ? { ...h, note } : h)) });
  const remove = (hid: string) =>
    onChange({ ...paper, highlights: paper.highlights.filter((h) => h.id !== hid) });

  return (
    <div className="annot-panel">
      <div className="annot-head">
        <span>Annotations {sorted.length > 0 && <span className="annot-count">{sorted.length}</span>}</span>
        <button className="refs-mini" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="refs-status">No highlights yet. Select text in the PDF and choose Highlight.</div>
      ) : (
        <div className="annot-list">
          {sorted.map((h, i) => (
            <div key={h.id} className="annot">
              <div className="annot-quote" onClick={() => onJump(h.page)}>
                <span className="annot-num">{i + 1}</span>
                <span className="annot-text">{h.text}</span>
              </div>
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
