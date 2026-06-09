import { useState } from "react";
import type { Paper } from "../types";
import { getSettings, saveSettings, type Settings } from "../lib/settings";

export default function SettingsView({ papers }: { papers: Paper[] }) {
  const [s, setS] = useState<Settings>(getSettings());
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  const indexed = papers.filter((p) => p.index).length;
  const highlights = papers.reduce((n, p) => n + p.highlights.length, 0);

  return (
    <div className="settings">
      <header className="lib-header">
        <div className="crumbs">
          <strong>Settings</strong>
        </div>
      </header>

      <section className="set-group">
        <h3>AI</h3>
        <div className="set-row">
          <label>Default model provider</label>
          <div className="provider">
            <button className={s.aiProvider === "claude" ? "current" : ""} onClick={() => update({ aiProvider: "claude" })}>
              Claude
            </button>
            <button className={s.aiProvider === "codex" ? "current" : ""} onClick={() => update({ aiProvider: "codex" })}>
              Codex
            </button>
          </div>
        </div>
        <p className="set-hint">
          Used for indexing, recommendations, search answers, and as the chat default — all via your local CLI.
        </p>

        <div className="set-row">
          <label>Model override</label>
          <input
            value={s.aiModel}
            placeholder="(CLI default)"
            onChange={(e) => update({ aiModel: e.target.value })}
          />
        </div>
        <p className="set-hint">
          Optional. Passed as <code>--model</code> to the CLI for all AI features (indexing, Discover, search, chat); leave blank to use its default.
        </p>

        <div className="set-col">
          <label>Custom instructions</label>
          <textarea
            value={s.aiInstructions}
            placeholder="e.g. Keep all responses concise — short paragraphs and bullet points."
            rows={3}
            onChange={(e) => update({ aiInstructions: e.target.value })}
          />
        </div>
        <p className="set-hint">Prepended to chat and search answers to steer tone and length.</p>
      </section>

      <section className="set-group">
        <h3>Library</h3>
        <div className="set-stats">
          <div className="set-stat">
            <span>{papers.length}</span> papers
          </div>
          <div className="set-stat">
            <span>{indexed}</span> indexed
          </div>
          <div className="set-stat">
            <span>{highlights}</span> highlights
          </div>
        </div>
        <p className="set-hint">Stored locally at ~/Library/Application Support/com.local.reader/</p>
      </section>
    </div>
  );
}
