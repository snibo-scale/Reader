import { useEffect, useRef, useState } from "react";
import type { Paper, ReadingList } from "../types";
import { needsIndexing } from "../lib/indexer";
import { tagTint } from "../lib/colors";
import { formatAuthors } from "../lib/util";
import { openPaperWindow } from "../lib/window";

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
  const [newName, setNewName] = useState("");
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
        setNewName("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setNewName("");
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const toggleInList = (listId: string) => {
    onChangeLists(
      lists.map((l) => {
        if (l.id !== listId) return l;
        const has = l.paperIds.includes(paper.id);
        return {
          ...l,
          paperIds: has ? l.paperIds.filter((id) => id !== paper.id) : [...l.paperIds, paper.id],
        };
      })
    );
  };

  const createListWith = () => {
    const name = newName.trim();
    if (!name) return;
    const list: ReadingList = {
      id: crypto.randomUUID(),
      name,
      paperIds: [paper.id],
      createdAt: new Date().toISOString(),
    };
    onChangeLists([...lists, list]);
    setNewName("");
  };

  return (
    <div className="card" style={{ background }} onClick={() => onOpen(paper.id)}>
      <div className="card-top">
        <span className="badge">{paper.year || "—"}</span>
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
            <div className="list-menu" onClick={(e) => e.stopPropagation()}>
                <div className="list-menu-title">Add to list</div>
                {lists.length === 0 && <div className="list-menu-empty">No lists yet</div>}
                {lists.map((l) => {
                  const has = l.paperIds.includes(paper.id);
                  return (
                    <button key={l.id} className="list-menu-item" onClick={() => toggleInList(l.id)}>
                      <span className="list-menu-check">{has ? "✓" : ""}</span>
                      <span className="list-menu-name">{l.name}</span>
                    </button>
                  );
                })}
                <div className="list-menu-new">
                  <input
                    value={newName}
                    placeholder="New list…"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createListWith();
                      if (e.key === "Escape") {
                        setMenuOpen(false);
                        setNewName("");
                      }
                    }}
                  />
                  <button onClick={createListWith} disabled={!newName.trim()}>
                    +
                  </button>
                </div>
            </div>
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
  onImportResearch: () => void;
  onIndexAll: () => void;
  onDismissNote: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
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
  onImportResearch,
  onIndexAll,
  onDismissNote,
  onOpen,
  onDelete,
  lists,
  onChangeLists,
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  // Track how many columns currently fit so we can lay cards out row-major
  // (left-to-right, then top-to-bottom) while still packing each column with no
  // vertical gaps — CSS multi-column would pack column-major and break the order.
  const COL_W = 230;
  const GAP = 20;
  const gridRef = useRef<HTMLDivElement>(null);
  const [numCols, setNumCols] = useState(1);
  const unindexed = papers.filter(needsIndexing).length;
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
  const sorted = [...papers].sort((a, b) => recency(b).localeCompare(recency(a)));
  // Recent = anything opened or added within the past week (recency order preserved).
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const shown = mode === "recent" ? sorted.filter((p) => recency(p) >= weekAgo) : sorted;
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
  const columns: Paper[][] = Array.from({ length: numCols }, () => []);
  shown.forEach((p, i) => columns[i % numCols].push(p));

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
          <button className="ghost-btn" onClick={onImportResearch} disabled={importing}>
            ⇪ Import from Research
          </button>
          <button className="ghost-btn" onClick={() => setUrlOpen((o) => !o)} disabled={importing}>
            🔗 Add link
          </button>
          <button className="add-btn" onClick={onImport} disabled={importing}>
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
