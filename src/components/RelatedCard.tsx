import { useMemo, useState } from "react";
import type { Paper } from "../types";
import { relatedPapers } from "../lib/connections";

interface Props {
  paper: Paper;
  papers: Paper[];
  onOpen: (id: string) => void;
}

export default function RelatedCard({ paper, papers, onOpen }: Props) {
  const [open, setOpen] = useState(false); // minimized by default
  const related = useMemo(() => relatedPapers(paper.id, papers, 6), [paper.id, papers]);
  if (related.length === 0) return null;

  return (
    <div className={"related-card" + (open ? " open" : "")}>
      <button className="related-card-head" onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span>Related</span>
        <span className="count">{related.length}</span>
      </button>
      {open && (
        <div className="related-card-body">
          {related.map((r) => (
            <button key={r.paper.id} className="related-item" onClick={() => onOpen(r.paper.id)}>
              <span className="related-title">{r.paper.title}</span>
              {r.shared.length > 0 && <span className="related-shared">{r.shared.slice(0, 3).join(" · ")}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
