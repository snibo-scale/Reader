import { useEffect, useMemo, useRef, useState } from "react";
import type { Paper, ReadingList } from "../types";
import { needsIndexing } from "../lib/indexStatus";
import { tagTint } from "../lib/colors";
import { formatAuthors } from "../lib/util";
import { openPaperWindow } from "../lib/window";
import ArxivSearch from "./ArxivSearch";
import ReadingListMenu from "./ReadingListMenu";

interface CardProps {
  paper: Paper;
  lists: ReadingList[];
  onChangeLists: (next: ReadingList[]) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function PaperCard({ paper, lists, onChangeLists, onOpen, onDelete }: CardProps) {
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
    <div className={"card" + (paper.readAt ? " read" : "")} style={{ background }} onClick={() => onOpen(paper.id)}>
      <div className="card-top">
        <span className="badge">{paper.year || "—"}</span>
        {paper.readAt && <span className="badge read-badge" title="Read">✓ Read</span>}
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
  onImported,
  lists,
  onChangeLists,
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
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
  const shown = useMemo(
    () => {
      if (mode !== "recent") return sorted;
      // Recent = anything opened or added within the past week (recency order preserved).
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return sorted.filter((p) => recency(p) >= weekAgo);
    },
    [mode, sorted]
  );
  const hasGrid = shown.length > 0;

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
          {mode === "all" ? "All Papers" : "Recent"}
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

      {papers.length === 0 ? (
        <div className="empty">
          <p>Your library is empty.</p>
          <button className="add-btn" onClick={onImport} disabled={importing}>
            {importing ? "Importing…" : "+ Add your first PDF"}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>Nothing opened or added in the past week — see All Papers.</p>
        </div>
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
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
