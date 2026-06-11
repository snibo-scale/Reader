import type { Paper } from "../types";
import { removeHighlight, setHighlightNote } from "../lib/util";
import NoteEditor from "./NoteEditor";

interface Props {
  paper: Paper;
  onChange: (p: Paper) => void;
  onClose: () => void;
  onJump: (page: number) => void;
}

export default function AnnotationsPanel({ paper, onChange, onClose, onJump }: Props) {
  const sorted = [...paper.highlights].sort((a, b) => a.page - b.page);
  const setNote = (hid: string, note: string) => onChange(setHighlightNote(paper, hid, note));
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
