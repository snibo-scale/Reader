import type { Heading } from "../lib/pdf";

interface Props {
  headings: Heading[] | null; // null = still scanning
  onJump: (page: number, yFrac: number) => void;
  onClose: () => void;
}

export default function TocPanel({ headings, onJump, onClose }: Props) {
  return (
    <div className="annot-panel">
      <div className="annot-head">
        <span>Contents {headings && headings.length > 0 && <span className="annot-count">{headings.length}</span>}</span>
        <button className="refs-mini" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {!headings ? (
        <div className="refs-status">Scanning for headings…</div>
      ) : headings.length === 0 ? (
        <div className="refs-status">No headings detected in this document.</div>
      ) : (
        <div className="annot-list">
          {headings.map((h, i) => (
            <div
              key={i}
              className="annot-quote"
              style={{ paddingLeft: 8 + Math.min(h.level, 3) * 14 }}
              onClick={() => onJump(h.page, h.yFrac)}
            >
              <span className="annot-text">{h.text}</span>
              <span className="annot-num">{h.page}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
