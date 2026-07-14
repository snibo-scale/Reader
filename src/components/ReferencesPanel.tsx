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
  onOpen: (id: string) => void;
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export default function ReferencesPanel({ refs, papers, busy, onReload, onClose, onImported, onOpen }: Props) {
  const [status, setStatus] = useState<Record<number, RowState>>({});

  // Map each reference key to the library paper, so an in-library ref is clickable.
  const { keys, titles } = useMemo(() => {
    const keys = new Map<string, Paper>();
    const titles = new Map<string, Paper>();
    for (const p of papers) {
      if (p.sourceKey) keys.set(baseArxivId(p.sourceKey), p);
      const t = normTitle(p.title);
      if (t.length > 3) titles.set(t, p);
    }
    return { keys, titles };
  }, [papers]);

  const inLibrary = (r: Reference): Paper | undefined =>
    (r.arxivId ? keys.get(baseArxivId(r.arxivId)) : undefined) ??
    (normTitle(r.title).length > 3 ? titles.get(normTitle(r.title)) : undefined);

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

  const haveCount = refs ? refs.filter((r) => inLibrary(r)).length : 0;

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
                  <div className="ref-title"><span className="ref-num">{i + 1}.</span> {r.title}</div>
                  <div className="ref-meta">
                    {[r.authors, r.year, r.arxivId && `arXiv:${r.arxivId}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {st === "exists" && have ? (
                  <button className="ref-badge ref-open" onClick={() => onOpen(have.id)} title="Open in library">
                    ✓ In library ›
                  </button>
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
