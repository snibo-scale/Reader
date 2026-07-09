import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Paper } from "../types";
import { analyzePaper, extractReferences, listPapers, readPaperText, updatePaper } from "../lib/api";
import { extractTailText, type Heading } from "../lib/pdf";
import { getPdfDoc, getPdfHeadings, getPdfText } from "../lib/pdfCache";
import { parseAnalysis, parseReferences } from "../lib/metadata";
import { applyAnalysis } from "../lib/indexer";
import { getModel, getProvider } from "../lib/settings";
import AnnotationsPanel from "./AnnotationsPanel";
import ChatPanel from "./ChatPanel";
import SummaryPanel from "./SummaryPanel";
import TocPanel from "./TocPanel";
import ReferencesPanel from "./ReferencesPanel";

type Tab = "notes" | "ai" | "summary" | "toc" | "refs";

/**
 * Standalone companion window (?workspace=<id>): every reader side-panel except
 * the document itself. Reads/writes the same library as the reader via
 * updatePaper; last write wins, same as any two paper windows editing one paper.
 * ponytail: no live cross-window sync — reloads on open, no push updates.
 */
export default function Workspace({ id }: { id: string }) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [paperText, setPaperText] = useState("");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [headings, setHeadings] = useState<Heading[] | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [refsBusy, setRefsBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");

  const isMd = paper?.kind === "markdown";

  useEffect(() => {
    let cancelled = false;
    listPapers().then((ps) => {
      if (cancelled) return;
      setPapers(ps);
      setPaper(ps.find((p) => p.id === id) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Load the text (for AI + summary) and, for PDFs, the doc + headings.
  useEffect(() => {
    if (!paper) return;
    let cancelled = false;
    (async () => {
      if (paper.kind === "markdown") {
        const t = await readPaperText(paper.id);
        if (!cancelled) setPaperText(t);
        return;
      }
      const d = await getPdfDoc(paper.id);
      if (cancelled) return;
      setDoc(d);
      getPdfText(paper.id, d).then((t) => !cancelled && setPaperText(t));
      getPdfHeadings(paper.id, d).then((h) => !cancelled && setHeadings(h));
    })();
    return () => {
      cancelled = true;
    };
  }, [paper?.id, paper?.kind]);

  const onChange = (p: Paper) => {
    setPaper(p);
    setPapers((list) => list.map((x) => (x.id === p.id ? p : x)));
    updatePaper(p);
  };

  const regenerateSummary = async () => {
    if (!paper || !paperText.trim() || summaryBusy) return;
    setSummaryBusy(true);
    try {
      const a = parseAnalysis(await analyzePaper(paperText, getProvider(), getModel()));
      if (a) onChange(applyAnalysis(paper, a));
    } catch {
      /* keep existing summary */
    } finally {
      setSummaryBusy(false);
    }
  };

  const reExtractRefs = async () => {
    if (!paper || !doc) return;
    setRefsBusy(true);
    try {
      const tail = await extractTailText(doc);
      onChange({ ...paper, references: parseReferences(await extractReferences(tail, getProvider(), getModel())) });
    } catch {
      /* keep prior references */
    } finally {
      setRefsBusy(false);
    }
  };

  if (!paper) return <div className="loading">Loading…</div>;

  // TOC jumps happen in whichever window shows the PDF — broadcast and let the
  // reader scroll itself (see the listener in Reader).
  const jump = (page: number, yFrac = 0) => emit("workspace-jump", { paperId: paper.id, page, yFrac });
  const close = () => getCurrentWebviewWindow().close();

  const TABS: [Tab, string][] = [
    ["notes", "✎ Notes"],
    ["ai", "✦ AI"],
    ["summary", "❝ Summary"],
    ["toc", "☰ Contents"],
    ["refs", "⬇ References"],
  ];

  return (
    <div className="workspace">
      <div className="workspace-tabs">
        {TABS.map(([t, label]) => (
          <button key={t} className={tab === t ? "current" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      <div className="workspace-body">
        {tab === "notes" && (
          <AnnotationsPanel paper={paper} docText={paperText} onChange={onChange} onClose={close} onJump={jump} />
        )}
        {tab === "ai" && (
          <ChatPanel
            paper={paper}
            paperText={paperText}
            seedContext=""
            onConsumeSeed={() => {}}
            onChange={onChange}
          />
        )}
        {tab === "summary" && (
          <SummaryPanel paper={paper} busy={summaryBusy} onRegenerate={regenerateSummary} onClose={close} />
        )}
        {tab === "toc" && (
          <TocPanel headings={isMd ? [] : headings} onJump={jump} onClose={close} />
        )}
        {tab === "refs" && (
          <ReferencesPanel
            refs={paper.references ?? null}
            papers={papers}
            busy={refsBusy}
            onReload={reExtractRefs}
            onClose={close}
            onImported={(p) => setPapers((list) => (list.some((x) => x.id === p.id) ? list : [p, ...list]))}
          />
        )}
      </div>
    </div>
  );
}
