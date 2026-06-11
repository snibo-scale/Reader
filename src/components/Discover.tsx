import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Paper } from "../types";
import { arxivSearch, importFromUrl, suggestQueries, type ArxivPaper } from "../lib/api";
import { parseStringArray } from "../lib/metadata";
import { readingProfile, similarInLibrary } from "../lib/connections";
import { baseArxivId, formatAuthors } from "../lib/util";
import { getModel, getProvider } from "../lib/settings";

export interface Rec extends ArxivPaper {
  matchedQuery: string;
}
export interface DiscoverCache {
  queries: string[];
  recs: Rec[];
}

interface Props {
  papers: Paper[];
  cache: DiscoverCache | null;
  onCache: (c: DiscoverCache) => void;
  onImported: (p: Paper) => void;
  onOpen: (id: string) => void;
}

export default function Discover({ papers, cache, onCache, onImported, onOpen }: Props) {
  const [status, setStatus] = useState<"loading" | "done" | "error">(cache ? "done" : "loading");
  const [error, setError] = useState("");
  const [queries, setQueries] = useState<string[]>(cache?.queries ?? []);
  const [recs, setRecs] = useState<Rec[]>(cache?.recs ?? []);
  const [added, setAdded] = useState<Record<string, "adding" | "added" | "error">>({});

  const addRec = async (r: Rec) => {
    setAdded((s) => ({ ...s, [r.id]: "adding" }));
    try {
      const paper = await importFromUrl(r.id);
      onImported(paper);
      setAdded((s) => ({ ...s, [r.id]: "added" }));
    } catch (e) {
      setAdded((s) => ({ ...s, [r.id]: String(e).includes("Already") ? "added" : "error" }));
    }
  };

  const run = useCallback(async () => {
    setStatus("loading");
    setError("");
    const indexed = papers.filter((p) => p.index);
    if (indexed.length === 0) {
      setRecs([]);
      setQueries([]);
      setStatus("done");
      return;
    }
    try {
      const profile = readingProfile(papers);
      const ctx =
        `Topics: ${profile.topics.join(", ")}\n` +
        `Keywords: ${profile.keywords.join(", ")}\n` +
        `Titles already read:\n- ${profile.titles.join("\n- ")}`;
      const raw = await suggestQueries(ctx, getProvider(), getModel());
      let qs = parseStringArray(raw).slice(0, 4);
      if (qs.length === 0) qs = profile.topics.slice(0, 3);
      setQueries(qs);

      const have = new Set<string>();
      for (const p of papers) if (p.sourceKey) have.add(p.sourceKey);
      const seen = new Set<string>();
      const out: Rec[] = [];
      for (const q of qs) {
        let results: ArxivPaper[] = [];
        try {
          results = await arxivSearch(q, 6);
        } catch {
          /* skip this query on network error */
        }
        for (const r of results) {
          const key = baseArxivId(r.id);
          if (have.has(key) || seen.has(key)) continue;
          seen.add(key);
          out.push({ ...r, matchedQuery: q });
        }
      }
      const top = out.slice(0, 24);
      setRecs(top);
      onCache({ queries: qs, recs: top });
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, [papers, onCache]);

  // Only fetch when there's no cached result — revisiting Discover spends no tokens.
  useEffect(() => {
    if (!cache) run();
  }, [run, cache]);

  const indexedCount = papers.filter((p) => p.index).length;

  return (
    <div className="discover">
      <header className="lib-header">
        <div className="crumbs">
          <strong>Discover</strong> <span className="sep">/</span> Recommended from your reading
        </div>
        <button className="ghost-btn" onClick={run} disabled={status === "loading"}>
          ↻ Refresh
        </button>
      </header>

      {indexedCount === 0 ? (
        <div className="empty">
          <p>Open and index a few papers first — recommendations are built from what you've read.</p>
        </div>
      ) : (
        <>
          {queries.length > 0 && (
            <div className="query-chips">
              <span className="chips-label">Exploring:</span>
              {queries.map((q, i) => (
                <span key={i} className="chip">
                  {q}
                </span>
              ))}
            </div>
          )}
          {status === "loading" && <div className="loading">Finding related work on arXiv…</div>}
          {status === "error" && (
            <div className="import-note">
              <span>Couldn't fetch recommendations: {error}</span>
            </div>
          )}
          <div className="rec-grid">
            {recs.map((r) => (
              <div key={r.id} className="rec-card">
                <div className="rec-top">
                  <span className="badge">{r.year || "—"}</span>
                  <span className="rec-q" title={`Matched query: ${r.matchedQuery}`}>
                    {r.matchedQuery}
                  </span>
                </div>
                <div className="rec-title">{r.title}</div>
                <div className="rec-authors">{formatAuthors(r.authors)}</div>
                <div className="rec-summary">
                  {r.summary.slice(0, 280)}
                  {r.summary.length > 280 ? "…" : ""}
                </div>
                {(() => {
                  const sim = similarInLibrary(`${r.title} ${r.summary}`, papers, 3);
                  if (sim.length === 0) return null;
                  return (
                    <div className="rec-similar">
                      <span className="rec-similar-label">↳ Related in your library:</span>
                      {sim.map(({ paper }, i) => (
                        <span key={paper.id}>
                          {i > 0 && ", "}
                          <button className="rec-link" onClick={() => onOpen(paper.id)} title={paper.title}>
                            {paper.title.length > 36 ? paper.title.slice(0, 36) + "…" : paper.title}
                          </button>
                        </span>
                      ))}
                    </div>
                  );
                })()}
                <div className="rec-actions">
                  <button
                    className="add-btn"
                    onClick={() => addRec(r)}
                    disabled={added[r.id] === "adding" || added[r.id] === "added"}
                  >
                    {added[r.id] === "added"
                      ? "✓ In library"
                      : added[r.id] === "adding"
                        ? "Adding…"
                        : added[r.id] === "error"
                          ? "Retry"
                          : "+ Add to library"}
                  </button>
                  <button className="ghost-btn" onClick={() => openUrl(r.link)}>
                    Open on arXiv ↗
                  </button>
                </div>
              </div>
            ))}
          </div>
          {status === "done" && recs.length === 0 && (
            <div className="empty">
              <p>No fresh recommendations right now. Try Refresh, or index more papers.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
