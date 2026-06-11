import { useMemo, useState } from "react";
import type { Paper } from "../types";
import { tagDotColor } from "../lib/colors";
import Presentation, { paperSlides, type Slide } from "./Presentation";

interface Props {
  papers: Paper[];
  onOpen: (id: string) => void;
  onUpdateNote: (paperId: string, highlightId: string, note: string) => void;
}

export default function Highlights({ papers, onOpen, onUpdateNote }: Props) {
  const [presenting, setPresenting] = useState(false);
  const withHl = useMemo(
    () => papers.filter((p) => p.highlights.length > 0).sort((a, b) => b.highlights.length - a.highlights.length),
    [papers]
  );
  const total = withHl.reduce((n, p) => n + p.highlights.length, 0);

  const slides: Slide[] = useMemo(() => withHl.flatMap(paperSlides), [withHl]);

  return (
    <div className="highlights">
      <header className="lib-header">
        <div className="crumbs">
          <strong>Highlights</strong> <span className="sep">/</span> {total} across {withHl.length} papers
        </div>
        <button className="ghost-btn" onClick={() => setPresenting(true)} disabled={total === 0}>
          ▶ Present
        </button>
      </header>

      {withHl.length === 0 ? (
        <div className="empty">
          <p>No highlights yet. Select text while reading and hit Highlight to collect it here.</p>
        </div>
      ) : (
        <div className="hl-digest">
          {withHl.map((p) => {
            const topic = p.index?.topics[0];
            const sorted = [...p.highlights].sort((a, b) => a.page - b.page);
            return (
              <section key={p.id} className="hl-group">
                <button className="hl-paper" onClick={() => onOpen(p.id)}>
                  <span className="dot" style={{ background: topic ? tagDotColor(topic) : "var(--base-300)" }} />
                  {p.title}
                  <span className="count">{p.highlights.length}</span>
                </button>
                <ul className="hl-quotes">
                  {sorted.map((h) => (
                    <li key={h.id} className="hl-quote" onClick={() => onOpen(p.id)}>
                      <span className="hl-mark">
                        “{h.text.length > 260 ? h.text.slice(0, 260) + "…" : h.text}”
                      </span>
                      <span className="hl-page">p.{h.page}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {presenting && (
        <Presentation slides={slides} onClose={() => setPresenting(false)} onUpdateNote={onUpdateNote} />
      )}
    </div>
  );
}
