import { useState } from "react";
import type { Paper } from "../types";
import { needsWork } from "../lib/indexer";
import { paperInCategory } from "../lib/connections";
import { tagTint } from "../lib/colors";
import { formatAuthors } from "../lib/util";
import { openPaperWindow } from "../lib/window";

interface CardProps {
  paper: Paper;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function PaperCard({ paper, onOpen, onDelete }: CardProps) {
  const topic = paper.index?.topics[0];
  const background = topic ? tagTint(topic) : "var(--paper)";
  return (
    <div className="card" style={{ background }} onClick={() => onOpen(paper.id)}>
      <div className="card-top">
        <span className="badge">{paper.year || "—"}</span>
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
  activeCategory: string | null;
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
}

export default function Library({
  papers,
  activeCategory,
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
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const unindexed = papers.filter(needsWork).length;
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
  const shown = activeCategory ? sorted.filter((p) => paperInCategory(p, activeCategory)) : sorted;
  return (
    <div className="library">
      <header className="lib-header">
        <div className="crumbs">
          <strong>My Library</strong> <span className="sep">/</span> {activeCategory ?? "Recent"}
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
          <p>No papers tagged "{activeCategory}".</p>
        </div>
      ) : (
        <div className="grid">
          {shown.map((p) => (
            <PaperCard key={p.id} paper={p} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
