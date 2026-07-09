import { useMemo, useRef, useState } from "react";
import type { Paper } from "../types";
import { tagTint } from "../lib/colors";
import { formatAuthors } from "../lib/util";

type Status = "todo" | "reading" | "done";

const COLS: { key: Status; label: string; dot: string }[] = [
  { key: "todo", label: "To Read", dot: "var(--base-400)" },
  { key: "reading", label: "Reading", dot: "var(--accent-400)" },
  { key: "done", label: "Read", dot: "var(--accent)" },
];

// Effective column: an explicit boardStatus wins, else derive from read state.
function statusOf(p: Paper): Status {
  if (p.boardStatus) return p.boardStatus;
  if (p.readAt) return "done";
  if ((p.readingProgress ?? 0) > 0) return "reading";
  return "todo";
}

interface Props {
  papers: Paper[];
  onOpen: (id: string) => void;
  onUpdate: (p: Paper) => void;
}

export default function Board({ papers, onOpen, onUpdate }: Props) {
  const [overCol, setOverCol] = useState<Status | null>(null);
  // Live drag offset so the card follows the cursor (HTML5 DnD is unreliable in
  // Tauri's WKWebView, so we track pointer events ourselves — same as Library's strip).
  const [lift, setLift] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);

  const byCol = useMemo(() => {
    const m: Record<Status, Paper[]> = { todo: [], reading: [], done: [] };
    for (const p of papers) m[statusOf(p)].push(p);
    return m;
  }, [papers]);

  const move = (p: Paper, to: Status) => {
    if (statusOf(p) === to) return;
    onUpdate({
      ...p,
      boardStatus: to,
      // Keep the "Read" concept coherent across the rest of the app.
      readAt: to === "done" ? p.readAt ?? new Date().toISOString() : null,
    });
  };

  const onDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { id, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
    }
    setLift({ id: d.id, dx: e.clientX - d.x, dy: e.clientY - d.y });
    const col = (document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]).find((el) =>
      el.dataset?.col
    );
    setOverCol((col?.dataset.col as Status) ?? null);
  };
  const onUp = (p: Paper) => {
    const d = drag.current;
    const to = overCol;
    drag.current = null;
    setOverCol(null);
    setLift(null);
    if (!d) return;
    if (!d.moved) return onOpen(p.id); // no real movement → treat as a tap
    if (to) move(p, to);
  };

  return (
    <div className="board">
      <header className="lib-header">
        <div className="crumbs">
          <strong>Board</strong>
        </div>
      </header>
      <div className="kanban">
        {COLS.map((c) => (
          <section
            key={c.key}
            data-col={c.key}
            className={"kanban-col" + (overCol === c.key ? " drag-over" : "")}
          >
            <div className="kanban-head" data-col={c.key}>
              <span className="kanban-dot" style={{ background: c.dot }} />
              <span className="kanban-name">{c.label}</span>
              <span className="kanban-count">{byCol[c.key].length}</span>
            </div>
            <div className="kanban-cards" data-col={c.key}>
              {byCol[c.key].map((p) => {
                const topic = p.index?.topics[0];
                return (
                  <article
                    key={p.id}
                    className="kanban-card"
                    style={{
                      background: topic ? tagTint(topic) : "var(--paper)",
                      ...(lift?.id === p.id && {
                        transform: `translate(${lift.dx}px, ${lift.dy}px)`,
                        zIndex: 10,
                        opacity: 0.92,
                        cursor: "grabbing",
                      }),
                    }}
                    onPointerDown={(e) => onDown(e, p.id)}
                    onPointerMove={onMove}
                    onPointerUp={() => onUp(p)}
                  >
                    <div className="kanban-card-title">{p.title}</div>
                    {p.authors && <div className="kanban-card-author">{formatAuthors(p.authors)}</div>}
                    <div className="kanban-card-foot">
                      <span>{p.year || "—"}</span>
                      {p.highlights.length > 0 && <span>◍ {p.highlights.length}</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
