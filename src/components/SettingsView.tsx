import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Paper } from "../types";
import {
  getSettings,
  saveSettings,
  type Settings,
  DEFAULT_INDEX_PROMPT,
  DEFAULT_REFS_PROMPT,
} from "../lib/settings";

interface Props {
  papers: Paper[];
  importing: boolean;
  onExport: () => void;
  onImportBackup: () => void;
}

export default function SettingsView({ papers, importing, onExport, onImportBackup }: Props) {
  const [s, setS] = useState<Settings>(getSettings());
  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  const indexed = papers.filter((p) => p.index).length;
  const highlights = papers.reduce((n, p) => n + p.highlights.length, 0);

  const [upd, setUpd] = useState("");
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const checkUpdate = async () => {
    setChecking(true);
    setUpd("Checking…");
    try {
      const update = await check();
      if (!update) {
        setUpd("You're on the latest version.");
        return;
      }
      setUpd(`Downloading v${update.version}…`);
      await update.downloadAndInstall();
      setUpd("Update installed — restarting…");
      await relaunch();
    } catch (e) {
      setUpd(`Update failed: ${e}`);
    } finally {
      setChecking(false);
    }
  };

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
        <h3>System prompts</h3>
        <p className="set-hint">
          The exact prompts sent to the CLI when indexing a paper. <code>{"{{text}}"}</code> is replaced with the
          (truncated) paper text. Changes apply the next time a paper is indexed or summarized.
        </p>

        <div className="set-col">
          <div className="set-col-head">
            <label>Indexing &amp; summary</label>
            <button className="set-reset" onClick={() => update({ indexPrompt: DEFAULT_INDEX_PROMPT })}>
              Reset
            </button>
          </div>
          <textarea
            className="set-prompt"
            value={s.indexPrompt}
            rows={12}
            onChange={(e) => update({ indexPrompt: e.target.value })}
          />
        </div>

        <div className="set-col">
          <div className="set-col-head">
            <label>Reference extraction</label>
            <button className="set-reset" onClick={() => update({ refsPrompt: DEFAULT_REFS_PROMPT })}>
              Reset
            </button>
          </div>
          <textarea
            className="set-prompt"
            value={s.refsPrompt}
            rows={10}
            onChange={(e) => update({ refsPrompt: e.target.value })}
          />
        </div>
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

        <div className="set-row">
          <label>Backup</label>
          <div className="provider">
            <button onClick={onExport}>⭳ Export</button>
            <button onClick={onImportBackup} disabled={importing}>
              ⭱ Restore
            </button>
          </div>
        </div>
        <p className="set-hint">
          Export saves papers, lists, annotations, summaries, and conversations to a file. Restore redownloads papers
          and recovers everything from a backup.
        </p>
      </section>

      <section className="set-group">
        <h3>Updates</h3>
        <div className="set-row">
          <label>Version</label>
          <span className="set-version">{version || "…"}</span>
        </div>
        <div className="set-row">
          <label>App updates</label>
          <button className="set-reset" onClick={checkUpdate} disabled={checking}>
            {checking ? "Working…" : "Check for updates"}
          </button>
        </div>
        {upd && <p className="set-hint">{upd}</p>}
        <p className="set-hint">Downloads and installs the latest release from GitHub, then restarts.</p>
      </section>
    </div>
  );
}
