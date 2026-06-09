import { useMemo } from "react";
import type { Paper } from "../types";
import { tagDotColor, tagTint } from "../lib/colors";

export default function Timeline({ papers, onOpen }: { papers: Paper[]; onOpen: (id: string) => void }) {
  const byYear = useMemo(() => {
    const m = new Map<string, Paper[]>();
    for (const p of papers) {
      const y = p.year && /^\d{4}$/.test(p.year) ? p.year : "Undated";
      m.set(y, [...(m.get(y) ?? []), p]);
    }
    return [...m.entries()].sort((a, b) => {
      if (a[0] === "Undated") return 1;
      if (b[0] === "Undated") return -1;
      return Number(b[0]) - Number(a[0]);
    });
  }, [papers]);

  return (
    <div className="timeline">
      <header className="lib-header">
        <div className="crumbs">
          <strong>Timeline</strong> <span className="sep">/</span> {papers.length} papers
        </div>
      </header>
      <div className="tl-track">
        {byYear.map(([year, ps]) => (
          <div key={year} className="tl-year">
            <div className="tl-year-label">
              {year}
              <span className="count">{ps.length}</span>
            </div>
            <div className="tl-papers">
              {ps.map((p) => {
                const topic = p.index?.topics[0];
                return (
                  <button
                    key={p.id}
                    className="tl-card"
                    style={{ background: topic ? tagTint(topic) : "var(--paper)" }}
                    onClick={() => onOpen(p.id)}
                    title={p.title}
                  >
                    <span
                      className="tl-dot"
                      style={{ background: topic ? tagDotColor(topic) : "var(--base-300)" }}
                    />
                    <span className="tl-title">{p.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
