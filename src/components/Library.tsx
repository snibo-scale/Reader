import { useEffect, useMemo, useRef, useState } from "react";
import type { Paper, ReadingList } from "../types";
import { needsIndexing } from "../lib/indexStatus";
import { tagTint } from "../lib/colors";
import { formatAuthors } from "../lib/util";
import { openPaperWindow } from "../lib/window";
import ArxivSearch from "./ArxivSearch";
import ReadingListMenu from "./ReadingListMenu";

/** Minimal monochrome pushpin, tinted via currentColor. */
function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </svg>
  );
}

interface CardProps {
  paper: Paper;
  lists: ReadingList[];
  onChangeLists: (next: ReadingList[]) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: (p: Paper) => void;
  onUpdate: (p: Paper) => void;
}

function PaperCard({ paper, lists, onChangeLists, onOpen, onDelete, onShare, onUpdate }: CardProps) {
  const topic = paper.index?.topics[0];
  const background = topic ? tagTint(topic) : "var(--paper)";
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inAnyList = lists.some((l) => l.paperIds.includes(paper.id));

  // Close the menu on an outside click or Escape. A full-screen backdrop element
  // can't be used here: as a DOM child of the card it would keep the card stuck in
  // its :hover state and block hovering other cards.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div
      className={"card" + (paper.readAt ? " read" : "") + (menuOpen ? " menu-open" : "")}
      style={{ background }}
      onClick={() => onOpen(paper.id)}
    >
      <div className="card-top">
        <span className="badge">{paper.year || "—"}</span>
        {paper.readAt && <span className="badge read-badge" title="Read">✓ Read</span>}
        <button
          className={"card-pin-btn" + (paper.pinnedAt ? " on" : "")}
          title={paper.pinnedAt ? "Unpin" : "Pin to the top strip"}
          onClick={(e) => {
            e.stopPropagation();
            onUpdate({ ...paper, pinnedAt: paper.pinnedAt ? null : new Date().toISOString() });
          }}
        >
          <PinIcon />
        </button>
        <div className="card-list-wrap" ref={wrapRef}>
          <button
            className={"card-list-btn" + (inAnyList ? " on" : "") + (menuOpen ? " open" : "")}
            title="Add to a reading list"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            {inAnyList ? "★" : "⊕"}
          </button>
          {menuOpen && (
            <ReadingListMenu
              lists={lists}
              paperId={paper.id}
              onChangeLists={onChangeLists}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>
      <div className="card-title">{paper.title}</div>
      <div className="card-author">{formatAuthors(paper.authors)}</div>
      <div className="card-bottom">
        <span className="hl-count" title="Highlights">
          ◍ {paper.highlights.length}
        </span>
        <div className="card-actions">
          <button
            className="card-win"
            title="Open in new window"
            onClick={(e) => {
              e.stopPropagation();
              openPaperWindow(paper.id, paper.title);
            }}
          >
            ⧉
          </button>
          <button
            className="card-win"
            title="Share (export with annotations)"
            onClick={(e) => {
              e.stopPropagation();
              onShare(paper);
            }}
          >
            ⇪
          </button>
          <button
            className="card-del"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${paper.title}"? This removes the stored PDF.`)) onDelete(paper.id);
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  papers: Paper[];
  mode: "recent" | "all";
  importing: boolean;
  importNote: string | null;
  indexProgress: { done: number; total: number } | null;
  onImport: () => void;
  onImportUrl: (url: string) => void;
  onIndexAll: () => void;
  onDismissNote: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: (p: Paper) => void;
  onUpdate: (p: Paper) => void;
  onImported: (p: Paper) => void;
  lists: ReadingList[];
  onChangeLists: (next: ReadingList[]) => void;
}

export default function Library({
  papers,
  mode,
  importing,
  importNote,
  indexProgress,
  onImport,
  onImportUrl,
  onIndexAll,
  onDismissNote,
  onOpen,
  onDelete,
  onShare,
  onUpdate,
  onImported,
  lists,
  onChangeLists,
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Live offset of the card being dragged, so it follows the cursor.
  const [lift, setLift] = useState<{ i: number; dx: number; dy: number } | null>(null);
  // Track how many columns currently fit so we can lay cards out row-major
  // (left-to-right, then top-to-bottom) while still packing each column with no
  // vertical gaps — CSS multi-column would pack column-major and break the order.
  const COL_W = 230;
  const GAP = 20;
  const gridRef = useRef<HTMLDivElement>(null);
  const [numCols, setNumCols] = useState(1);
  const unindexed = useMemo(() => papers.filter(needsIndexing).length, [papers]);
  const indexing = indexProgress !== null;
  const submitUrl = () => {
    if (!url.trim()) return;
    onImportUrl(url.trim());
    setUrl("");
    setUrlOpen(false);
  };
  // Most-recent activity = last opened, falling back to date added (ISO sorts chronologically).
  const recency = (p: Paper) => {
    const added = p.addedAt ?? "";
    const opened = p.lastOpenedAt ?? "";
    return opened > added ? opened : added;
  };
  const sorted = useMemo(() => [...papers].sort((a, b) => recency(b).localeCompare(recency(a))), [papers]);
  // "Continue reading" strip: pinned papers first (newest pin first), then the
  // most recently opened unfinished papers to fill it up to 5.
  const continueReading = useMemo(() => {
    if (mode !== "recent") return [];
    const pinned = papers
      .filter((p) => p.pinnedAt)
      .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const recent = papers
      .filter((p) => p.lastOpenedAt && !p.readAt && !pinnedIds.has(p.id))
      .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
    const base = [...pinned, ...recent.slice(0, Math.max(0, 5 - pinned.length))];
    // Manual drag order (homeOrder) wins; papers without one keep their natural
    // pin/recency position as the tiebreak.
    const natural = new Map(base.map((p, i) => [p.id, i]));
    return [...base].sort(
      (a, b) => (a.homeOrder ?? natural.get(a.id)!) - (b.homeOrder ?? natural.get(b.id)!)
    );
  }, [mode, papers]);
  const shown = useMemo(
    () => {
      if (mode !== "recent") return sorted;
      // Recent = anything opened or added within the past week (recency order
      // preserved), minus what the continue-reading strip already shows.
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const inStrip = new Set(continueReading.map((p) => p.id));
      return sorted.filter((p) => recency(p) >= weekAgo && !inStrip.has(p.id));
    },
    [mode, sorted, continueReading]
  );
  const hasGrid = shown.length > 0;

  // Strip reorder via pointer events. HTML5 drag-and-drop is unreliable in Tauri's
  // WKWebView (dragover/drop don't fire consistently), so we track the pointer
  // ourselves. preventDefault on pointerdown stops the native text selection; a 4px
  // threshold distinguishes a reorder from a tap-to-open. On release we splice the
  // moved card in and persist every position as homeOrder so it survives reloads.
  const drag = useRef<{ from: number; x: number; y: number; moved: boolean } | null>(null);
  const onCardPointerDown = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { from: i, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onCardPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
    }
    setLift({ i: d.from, dx: e.clientX - d.x, dy: e.clientY - d.y });
    // elementsFromPoint (plural) so the lifted card on top doesn't mask the one beneath.
    const target = (document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]).find(
      (el) => el.classList?.contains("continue-card") && el.dataset.idx !== String(d.from)
    );
    setOverIndex(target?.dataset.idx ? Number(target.dataset.idx) : null);
  };
  const onCardPointerUp = (id: string) => {
    const d = drag.current;
    const to = overIndex;
    drag.current = null;
    setOverIndex(null);
    setLift(null);
    if (!d) return;
    if (!d.moved) { onOpen(id); return; } // no real movement → treat as a tap
    if (to === null || to === d.from) return;
    const next = [...continueReading];
    const [moved] = next.splice(d.from, 1);
    next.splice(to, 0, moved);
    next.forEach((p, i) => {
      if (p.homeOrder !== i) onUpdate({ ...p, homeOrder: i });
    });
  };

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () =>
      setNumCols(Math.max(1, Math.floor((el.clientWidth + GAP) / (COL_W + GAP))));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasGrid]);

  // Round-robin so reading order is left-to-right across a row, then the next row.
  const columns = useMemo(() => {
    const next: Paper[][] = Array.from({ length: numCols }, () => []);
    shown.forEach((p, i) => next[i % numCols].push(p));
    return next;
  }, [numCols, shown]);

  return (
    <div className="library">
      <header className="lib-header">
        <div className="crumbs">
          <strong>My Library</strong> <span className="sep">/</span>{" "}
          {mode === "all" ? "All Papers" : "Home"}
        </div>
        <div className="lib-actions">
          <button className="ghost-btn" onClick={onIndexAll} disabled={indexing || unindexed === 0}>
            {indexing
              ? `Indexing ${indexProgress!.done}/${indexProgress!.total}…`
              : `✦ Index all${unindexed > 0 ? ` (${unindexed})` : ""}`}
          </button>
          <span className="bar-divider" />
          <button
            className="ghost-btn"
            title="Search arXiv"
            onClick={() => {
              setSearchOpen((o) => !o);
              setUrlOpen(false);
            }}
            disabled={importing}
          >
            ⌕ arXiv
          </button>
          <button
            className="ghost-btn"
            title="Add by arXiv link, id, or PDF URL"
            onClick={() => {
              setUrlOpen((o) => !o);
              setSearchOpen(false);
            }}
            disabled={importing}
          >
            ↗ Link
          </button>
          <button className="add-btn" onClick={onImport} disabled={importing} title="Add a PDF from your computer">
            {importing ? "Importing…" : "+ Add item"}
          </button>
        </div>
      </header>

      {urlOpen && (
        <div className="url-form">
          <input
            autoFocus
            value={url}
            placeholder="Paste an arXiv link, arXiv id, or direct PDF URL…"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitUrl();
              if (e.key === "Escape") setUrlOpen(false);
            }}
          />
          <button className="add-btn" onClick={submitUrl} disabled={importing || !url.trim()}>
            {importing ? "Adding…" : "Add"}
          </button>
          <button className="ghost-btn" onClick={() => setUrlOpen(false)}>
            Cancel
          </button>
        </div>
      )}

      {searchOpen && <ArxivSearch papers={papers} onImported={onImported} />}

      {importNote && (
        <div className="import-note">
          <span>{importNote}</span>
          <button onClick={onDismissNote}>✕</button>
        </div>
      )}

      {continueReading.length > 0 && (
        <>
          <div className="continue-row">
            {continueReading.map((p, i) => {
              const topic = p.index?.topics[0];
              const pct = Math.round((p.readingProgress ?? 0) * 100);
              return (
                <div
                  key={p.id}
                  data-idx={i}
                  className={"continue-card" + (overIndex === i ? " drag-over" : "")}
                  style={{
                    background: topic ? tagTint(topic) : "var(--paper)",
                    ...(lift?.i === i && {
                      transform: `translate(${lift.dx}px, ${lift.dy}px)`,
                      transition: "none",
                      zIndex: 10,
                      opacity: 0.9,
                      cursor: "grabbing",
                    }),
                  }}
                  onPointerDown={(e) => onCardPointerDown(e, i)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={() => onCardPointerUp(p.id)}
                >
                  <button
                    className={"continue-pin" + (p.pinnedAt ? " on" : "")}
                    title={p.pinnedAt ? "Unpin" : "Pin here"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate({ ...p, pinnedAt: p.pinnedAt ? null : new Date().toISOString() });
                    }}
                  >
                    <PinIcon size={12} />
                  </button>
                  <div className="continue-title">{p.title}</div>
                  <div className="continue-author">{formatAuthors(p.authors)}</div>
                  <div className="continue-foot">
                    <span className="continue-bar">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    <span className="continue-pct">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <hr className="continue-divider" />
        </>
      )}

      {papers.length === 0 ? (
        <div className="empty">
          <p>Your library is empty.</p>
          <button className="add-btn" onClick={onImport} disabled={importing}>
            {importing ? "Importing…" : "+ Add your first PDF"}
          </button>
        </div>
      ) : shown.length === 0 ? (
        continueReading.length === 0 && (
          <div className="empty">
            <p>Nothing opened or added in the past week — see All Papers.</p>
          </div>
        )
      ) : (
        <div className="grid" ref={gridRef}>
          {columns.map((col, ci) => (
            <div className="grid-col" key={ci}>
              {col.map((p) => (
                <PaperCard
                  key={p.id}
                  paper={p}
                  lists={lists}
                  onChangeLists={onChangeLists}
                  onOpen={onOpen}
                  onDelete={onDelete}
                  onShare={onShare}
                  onUpdate={onUpdate}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
