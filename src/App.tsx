import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Paper, ReadingList } from "./types";
import {
  deletePaper,
  exportLibrary,
  importFromResearch,
  importFromUrl,
  importLibrary,
  importPaper,
  listPapers,
  listReadingLists,
  saveReadingLists,
  updatePaper,
} from "./lib/api";
import { needsIndexing } from "./lib/indexStatus";
import { setHighlightNote } from "./lib/util";
import { getModel, getProvider } from "./lib/settings";
import Sidebar, { type View } from "./components/Sidebar";
import Library from "./components/Library";
import type { DiscoverCache } from "./components/Discover";

const Reader = lazy(() => import("./components/Reader"));
const Discover = lazy(() => import("./components/Discover"));
const SearchView = lazy(() => import("./components/SearchView"));
const Timeline = lazy(() => import("./components/Timeline"));
const Highlights = lazy(() => import("./components/Highlights"));
const ReadingLists = lazy(() => import("./components/ReadingLists"));
const SettingsView = lazy(() => import("./components/SettingsView"));

export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [lists, setLists] = useState<ReadingList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("library");
  const [navOpen, setNavOpen] = useState(true);
  const [discoverCache, setDiscoverCache] = useState<DiscoverCache | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [indexingIds, setIndexingIds] = useState<Set<string>>(new Set());
  const importedOnce = useRef(false);
  const indexingRef = useRef<Set<string>>(new Set());
  const pendingWindowPaper = useRef<string | null>(
    new URLSearchParams(window.location.search).get("paper")
  );

  // Always-current mirror of `papers` so callbacks can read the latest committed
  // state synchronously (without capturing it as a side-effect inside a setState
  // updater, which React 18 runs lazily — that drops writes like lastOpenedAt).
  const papersRef = useRef<Paper[]>([]);
  useEffect(() => {
    papersRef.current = papers;
  }, [papers]);

  const refresh = useCallback(async () => {
    const [ps, ls] = await Promise.all([listPapers(), listReadingLists()]);
    setPapers(ps);
    setLists(ls);
  }, []);

  // Persist the whole reading-list collection in one atomic write; the views build
  // the next array (create/rename/reorder/membership) and hand it back here.
  const commitLists = useCallback((next: ReadingList[]) => {
    setLists(next);
    saveReadingLists(next);
  }, []);

  // Merge an indexing result onto the latest paper (preserving highlights/notes/
  // sessions that may have changed while indexing ran), then persist.
  const applyIndexResult = useCallback((id: string, u: Paper) => {
    const p = papersRef.current.find((x) => x.id === id);
    if (!p) return;
    const merged: Paper = {
      ...p,
      title: u.title,
      year: u.year,
      authors: u.authors,
      index: u.index,
      references: u.references,
    };
    setPapers((list) => list.map((x) => (x.id === id ? merged : x)));
    updatePaper(merged);
  }, []);

  // Index a paper in the BACKGROUND (App stays mounted) so it keeps running and
  // persists even if the reader is exited. Triggered on add and on open; runs once
  // per paper and only the steps that are missing.
  const ensureIndexed = useCallback(
    (paper: Paper) => {
      if (!needsIndexing(paper) || indexingRef.current.has(paper.id)) return;
      indexingRef.current.add(paper.id);
      setIndexingIds(new Set(indexingRef.current));
      import("./lib/indexer")
        .then(({ buildIndex }) => buildIndex(paper, getProvider(), getModel()))
        .then((u) => {
          if (u) applyIndexResult(paper.id, u);
        })
        .catch(() => {
          /* retry next open */
        })
        .finally(() => {
          indexingRef.current.delete(paper.id);
          setIndexingIds(new Set(indexingRef.current));
        });
    },
    [applyIndexResult]
  );

  // On launch: pull in anything from the un.ms Research app (idempotent / de-duped).
  useEffect(() => {
    if (importedOnce.current) return;
    importedOnce.current = true;
    (async () => {
      try {
        const res = await importFromResearch();
        if (res.imported > 0) setImportNote(`Imported ${res.imported} paper(s) from Research`);
      } catch {
        /* Research app not present — ignore */
      } finally {
        await refresh();
      }
    })();
  }, [refresh]);

  // Import/backup notices auto-dismiss after a few seconds (they also fade via CSS).
  useEffect(() => {
    if (!importNote) return;
    const t = setTimeout(() => setImportNote(null), 4000);
    return () => clearTimeout(t);
  }, [importNote]);

  const handleImport = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected || typeof selected !== "string") return;
    setImporting(true);
    try {
      const paper = await importPaper(selected);
      setPapers((prev) => [paper, ...prev]);
      ensureIndexed(paper);
    } catch (e) {
      setImportNote(String(e));
    } finally {
      setImporting(false);
    }
  }, [ensureIndexed]);

  const handleImportUrl = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setImporting(true);
    try {
      const paper = await importFromUrl(url.trim());
      setPapers((prev) => [paper, ...prev]);
      setImportNote(`Added "${paper.title}"`);
      ensureIndexed(paper);
    } catch (e) {
      setImportNote(String(e));
    } finally {
      setImporting(false);
    }
  }, [ensureIndexed]);

  const handleExport = useCallback(async () => {
    const path = await save({
      defaultPath: `reader-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "Reader backup", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      const n = await exportLibrary(path);
      setImportNote(`Exported ${n} paper(s) to backup`);
    } catch (e) {
      setImportNote(String(e));
    }
  }, []);

  const handleImportBackup = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Reader backup", extensions: ["json"] }],
    });
    if (!selected || typeof selected !== "string") return;
    setImporting(true);
    try {
      const res = await importLibrary(selected);
      const tail = res.skipped > 0 ? ` (${res.skipped} skipped)` : "";
      setImportNote(`Restored ${res.imported} paper(s)${tail}`);
      await refresh();
    } catch (e) {
      setImportNote(String(e));
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  const handleUpdate = useCallback(async (paper: Paper) => {
    setPapers((list) => list.map((p) => (p.id === paper.id ? paper : p)));
    await updatePaper(paper);
  }, []);

  // Index every un-indexed paper, one at a time, in the background. A paper counts
  // as un-indexed until both its analysis and references are done; buildIndex runs
  // only the missing steps, so already-indexed papers are skipped.
  const handleIndexAll = useCallback(async () => {
    const todo = papers.filter(needsIndexing).map((p) => p.id);
    if (todo.length === 0) {
      setImportNote("All papers are already indexed");
      return;
    }
    setIndexProgress({ done: 0, total: todo.length });
    const { buildIndex } = await import("./lib/indexer");
    for (let i = 0; i < todo.length; i++) {
      // Re-read the latest paper each iteration: it may have been edited (or
      // already indexed in the background) since the button was clicked.
      const current = papersRef.current.find((p) => p.id === todo[i]);
      if (current && needsIndexing(current) && !indexingRef.current.has(current.id)) {
        try {
          const updated = await buildIndex(current, getProvider(), getModel());
          if (updated) applyIndexResult(current.id, updated);
        } catch {
          /* skip papers that fail to index */
        }
      }
      setIndexProgress({ done: i + 1, total: todo.length });
    }
    setIndexProgress(null);
    setImportNote(`Indexed ${todo.length} paper(s)`);
  }, [papers, applyIndexResult]);

  const handleDelete = useCallback(async (id: string) => {
    await deletePaper(id);
    // Dynamic import keeps pdfCache -> pdf.js out of the startup bundle.
    void import("./lib/pdfCache").then((m) => m.clearPdfCache(id));
    setPapers((list) => list.filter((p) => p.id !== id));
    // Rust prunes the id from lists.json; mirror that in local state.
    setLists((ls) => ls.map((l) => ({ ...l, paperIds: l.paperIds.filter((pid) => pid !== id) })));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const openPaper = useCallback(
    (id: string) => {
      setActiveId(id);
      const target = papersRef.current.find((p) => p.id === id);
      if (!target) return;
      const updated: Paper = { ...target, lastOpenedAt: new Date().toISOString() };
      setPapers((list) => list.map((p) => (p.id === id ? updated : p)));
      updatePaper(updated);
      ensureIndexed(updated); // continue/start background indexing (survives exit)
    },
    [ensureIndexed]
  );

  // If launched as a dedicated paper window (?paper=ID), open it once loaded.
  useEffect(() => {
    const id = pendingWindowPaper.current;
    if (id && papers.some((p) => p.id === id)) {
      pendingWindowPaper.current = null;
      openPaper(id);
    }
  }, [papers, openPaper]);

  const handleImported = useCallback(
    (paper: Paper) => {
      setPapers((prev) => (prev.some((p) => p.id === paper.id) ? prev : [paper, ...prev]));
      ensureIndexed(paper);
    },
    [ensureIndexed]
  );

  const handleUpdateNote = useCallback((paperId: string, highlightId: string, note: string) => {
    const p = papersRef.current.find((x) => x.id === paperId);
    if (!p) return;
    const updated = setHighlightNote(p, highlightId, note);
    setPapers((list) => list.map((x) => (x.id === paperId ? updated : x)));
    updatePaper(updated);
  }, []);

  const navigate = useCallback((v: View) => {
    setActiveId(null);
    setView(v);
  }, []);

  const active = papers.find((p) => p.id === activeId) ?? null;

  let main;
  if (active) {
    main = (
      <Reader
        key={active.id}
        paper={active}
        papers={papers}
        indexing={indexingIds.has(active.id)}
        onBack={() => setActiveId(null)}
        onChange={handleUpdate}
        onOpenPaper={openPaper}
        onImported={handleImported}
        lists={lists}
        onChangeLists={commitLists}
      />
    );
  } else if (view === "search") {
    main = <SearchView papers={papers} onOpen={openPaper} lists={lists} onChangeLists={commitLists} />;
  } else if (view === "discover") {
    main = (
      <Discover
        papers={papers}
        cache={discoverCache}
        onCache={setDiscoverCache}
        onImported={handleImported}
        onOpen={openPaper}
      />
    );
  } else if (view === "timeline") {
    main = <Timeline papers={papers} onOpen={openPaper} />;
  } else if (view === "reading") {
    main = (
      <ReadingLists
        papers={papers}
        lists={lists}
        onChangeLists={commitLists}
        onOpen={openPaper}
      />
    );
  } else if (view === "highlights") {
    main = <Highlights papers={papers} onOpen={openPaper} onUpdateNote={handleUpdateNote} />;
  } else if (view === "settings") {
    main = (
      <SettingsView
        papers={papers}
        importing={importing}
        onExport={handleExport}
        onImportBackup={handleImportBackup}
      />
    );
  } else {
    main = (
      <Library
        papers={papers}
        mode={view === "all" ? "all" : "recent"}
        importing={importing}
        importNote={importNote}
        indexProgress={indexProgress}
        onImport={handleImport}
        onImportUrl={handleImportUrl}
        onIndexAll={handleIndexAll}
        onDismissNote={() => setImportNote(null)}
        onOpen={openPaper}
        onDelete={handleDelete}
        onImported={handleImported}
        lists={lists}
        onChangeLists={commitLists}
      />
    );
  }

  return (
    <div className="app">
      <Sidebar
        view={view}
        inReader={!!active}
        collapsed={!navOpen}
        onToggle={() => setNavOpen((o) => !o)}
        onNavigate={navigate}
      />
      <main className="main">
        <Suspense fallback={<div className="loading">Loading…</div>}>{main}</Suspense>
      </main>
    </div>
  );
}
