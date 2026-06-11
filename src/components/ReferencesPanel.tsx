import { useMemo, useState } from "react";
import type { Paper } from "../types";
import type { Reference } from "../lib/metadata";
import { arxivSearch, importFromUrl } from "../lib/api";
import { baseArxivId } from "../lib/util";

type RowState = "idle" | "adding" | "added" | "exists" | "notfound" | "error";

interface Props {
  refs: Reference[] | null;
  papers: Paper[];
  busy: boolean;
  onReload: () => void;
  onClose: () => void;
  onImported: (p: Paper) => void;
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export default function ReferencesPanel({ refs, papers, busy, onReload, onClose, onImported }: Props) {
  const [status, setStatus] = useState<Record<number, RowState>>({});

  // Which references are already in the library (by arXiv id or normalized title).
  const { keys, titles } = useMemo(() => {
    const keys = new Set<string>();
    const titles = new Set<string>();
    for (const p of papers) {
      if (p.sourceKey) keys.add(baseArxivId(p.sourceKey));
      const t = normTitle(p.title);
      if (t.length > 3) titles.add(t);
    }
    return { keys, titles };
  }, [papers]);

  const inLibrary = (r: Reference) =>
    (!!r.arxivId && keys.has(baseArxivId(r.arxivId))) || (normTitle(r.title).length > 3 && titles.has(normTitle(r.title)));

  const add = async (i: number, r: Reference) => {
    setStatus((s) => ({ ...s, [i]: "adding" }));
    try {
      let target = r.arxivId.trim();
      if (!target) {
        const hits = await arxivSearch(r.title, 1);
        if (hits[0]) target = hits[0].id;
      }
      if (!target) {
        setStatus((s) => ({ ...s, [i]: "notfound" }));
        return;
      }
      const paper = await importFromUrl(target);
      onImported(paper);
      setStatus((s) => ({ ...s, [i]: "added" }));
    } catch (e) {
      const msg = String(e);
      setStatus((s) => ({ ...s, [i]: msg.includes("Already") ? "exists" : "error" }));
    }
  };

  const label = (st: RowState) =>
    st === "adding" ? "Adding…" : st === "notfound" ? "Not found" : st === "error" ? "Retry" : "Add";

  const haveCount = refs ? refs.filter(inLibrary).length : 0;

  return (
    <div className="refs-panel">
      <div className="refs-head">
        <span>
          References{refs ? ` (${refs.length})` : ""}
          {haveCount > 0 && <span className="refs-have"> · {haveCount} in library</span>}
        </span>
        <div>
          {refs && (
            <button className="refs-mini" onClick={onReload} disabled={busy} title="Re-extract">
              ↻
            </button>
          )}
          <button className="refs-mini" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      {busy && <div className="refs-status">Reading the bibliography…</div>}
      {!busy && refs === null && (
        <div className="refs-status">
          References not extracted yet.
          <button className="ref-add" onClick={onReload} style={{ marginLeft: 10 }}>
            Extract
          </button>
        </div>
      )}
      {!busy && refs && refs.length === 0 && <div className="refs-status">No references found.</div>}

      {refs && refs.length > 0 && (
        <div className="refs-list">
          {refs.map((r, i) => {
            const have = inLibrary(r);
            const st: RowState = have ? "exists" : status[i] ?? "idle";
            return (
              <div key={i} className={"ref-row" + (have ? " in-lib" : "")}>
                <div className="ref-main">
                  <div className="ref-title">{r.title}</div>
                  <div className="ref-meta">
                    {[r.authors, r.year, r.arxivId && `arXiv:${r.arxivId}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {st === "exists" ? (
                  <span className="ref-badge">✓ In library</span>
                ) : st === "added" ? (
                  <span className="ref-badge">✓ Added</span>
                ) : (
                  <button
                    className="ref-add"
                    disabled={st === "adding" || st === "notfound"}
                    onClick={() => add(i, r)}
                  >
                    {label(st)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
