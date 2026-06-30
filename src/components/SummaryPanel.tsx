import type { Paper } from "../types";

interface Props {
  paper: Paper;
  busy: boolean;
  onRegenerate: () => void;
  onClose: () => void;
}

/** Surfaces the summary generated during analysis (index card). */
export default function SummaryPanel({ paper, busy, onRegenerate, onClose }: Props) {
  const idx = paper.index;
  const summary = idx?.summary?.trim();

  return (
    <div className="annot-panel">
      <div className="annot-head">
        <span>Summary</span>
        <div className="summary-head-actions">
          <button className="refs-mini" onClick={onRegenerate} disabled={busy} title="Regenerate from analysis">
            ↻
          </button>
          <button className="refs-mini" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="summary-body">
        {busy && !summary ? (
          <div className="refs-status">Analyzing paper…</div>
        ) : summary ? (
          <>
            <p className="summary-text">{summary}</p>

            {idx!.contributions.length > 0 && (
              <div className="summary-section">
                <div className="summary-label">Contributions</div>
                <ul className="summary-contribs">
                  {idx!.contributions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {idx!.topics.length > 0 && (
              <div className="summary-section">
                <div className="summary-label">Topics</div>
                <div className="query-chips">
                  {idx!.topics.map((t, i) => (
                    <span className="chip" key={i}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="refs-status">
            No summary yet.
            <div className="summary-empty-action">
              <button className="toggle" onClick={onRegenerate} disabled={busy}>
                ✦ Generate summary
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
