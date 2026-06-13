import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Paper } from "../types";
import { arxivSearch, importFromUrl, type ArxivPaper } from "../lib/api";
import { baseArxivId, formatAuthors } from "../lib/util";

interface Props {
  papers: Paper[];
  onImported: (p: Paper) => void;
}

type AddState = "adding" | "added" | "error";

export default function ArxivSearch({ papers, onImported }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [results, setResults] = useState<ArxivPaper[]>([]);
  const [added, setAdded] = useState<Record<string, AddState>>({});

  // arXiv ids (version-stripped) already in the library, so results can be marked.
  const have = new Set(
    papers.map((p) => p.sourceKey).filter((k): k is string => !!k)
  );

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    setStatus("loading");
    setError("");
    try {
      const res = await arxivSearch(q, 12);
      setResults(res);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };

  const add = async (r: ArxivPaper) => {
    setAdded((s) => ({ ...s, [r.id]: "adding" }));
    try {
      const paper = await importFromUrl(r.id);
      onImported(paper);
      setAdded((s) => ({ ...s, [r.id]: "added" }));
    } catch (e) {
      setAdded((s) => ({ ...s, [r.id]: String(e).includes("Already") ? "added" : "error" }));
    }
  };

  return (
    <div className="arxiv-search">
      <div className="url-form">
        <input
          autoFocus
          value={query}
          placeholder="Search arXiv by title, author, or keywords…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
        />
        <button className="add-btn" onClick={run} disabled={status === "loading" || !query.trim()}>
          {status === "loading" ? "Searching…" : "Search"}
        </button>
      </div>

      {status === "error" && (
        <div className="import-note">
          <span>Search failed: {error}</span>
        </div>
      )}
      {status === "done" && results.length === 0 && (
        <div className="empty">
          <p>No results on arXiv for that query.</p>
        </div>
      )}

      {results.length > 0 && (
        <ul className="arxiv-results">
          {results.map((r) => {
            const inLib = have.has(baseArxivId(r.id));
            const st = inLib ? "added" : added[r.id];
            return (
              <li key={r.id} className="arxiv-result">
                <div className="arxiv-main">
                  <div className="arxiv-title">{r.title}</div>
                  <div className="arxiv-meta">
                    {formatAuthors(r.authors)} · {r.year || "—"}
                  </div>
                  {r.summary && (
                    <div className="arxiv-summary">
                      {r.summary.slice(0, 220)}
                      {r.summary.length > 220 ? "…" : ""}
                    </div>
                  )}
                </div>
                <div className="arxiv-actions">
                  <button
                    className="add-btn"
                    onClick={() => add(r)}
                    disabled={st === "adding" || st === "added"}
                  >
                    {st === "added"
                      ? "✓ In library"
                      : st === "adding"
                        ? "Downloading…"
                        : st === "error"
                          ? "Retry"
                          : "↓ Download"}
                  </button>
                  <button className="ghost-btn" onClick={() => openUrl(r.link)} title="Open on arXiv">
                    ↗
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
