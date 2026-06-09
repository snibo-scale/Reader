import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Paper } from "./types";
import {
  deletePaper,
  importFromResearch,
  importFromUrl,
  importPaper,
  listPapers,
  updatePaper,
} from "./lib/api";
import { buildIndex, needsWork } from "./lib/indexer";
import { getModel, getProvider } from "./lib/settings";
import Sidebar, { type View } from "./components/Sidebar";
import Library from "./components/Library";
import Reader from "./components/Reader";
import Discover, { type DiscoverCache } from "./components/Discover";
import GraphCanvas from "./components/GraphCanvas";
import SearchView from "./components/SearchView";
import Timeline from "./components/Timeline";
import Highlights from "./components/Highlights";
import SettingsView from "./components/SettingsView";

export default function App() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("library");
  const [category, setCategory] = useState<string | null>(null);
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

  const refresh = useCallback(async () => {
    setPapers(await listPapers());
  }, []);

  // Merge an indexing result onto the latest paper (preserving highlights/notes/
  // sessions that may have changed while indexing ran), then persist.
  const applyIndexResult = useCallback((id: string, u: Paper) => {
    let merged: Paper | null = null;
    setPapers((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        merged = {
          ...p,
          title: u.title,
          year: u.year,
          authors: u.authors,
          metadataExtracted: u.metadataExtracted,
          index: u.index,
          references: u.references,
        };
        return merged;
      })
    );
    if (merged) updatePaper(merged);
  }, []);

  // Index a paper in the BACKGROUND (App stays mounted) so it keeps running and
  // persists even if the reader is exited. Triggered on add and on open; runs once
  // per paper and only the steps that are missing.
  const ensureIndexed = useCallback(
    (paper: Paper) => {
      if (!needsWork(paper) || indexingRef.current.has(paper.id)) return;
      indexingRef.current.add(paper.id);
      setIndexingIds(new Set(indexingRef.current));
      buildIndex(paper, getProvider(), getModel())
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

  const handleResearchImport = useCallback(async () => {
    setImporting(true);
    try {
      const res = await importFromResearch();
      setImportNote(
        res.imported > 0
          ? `Imported ${res.imported} new paper(s)`
          : "No new papers to import — library is up to date"
      );
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

  // Index every un-indexed paper, one at a time, in the background.
  const handleIndexAll = useCallback(async () => {
    const todo = papers.filter(needsWork);
    if (todo.length === 0) {
      setImportNote("All papers are already indexed");
      return;
    }
    setIndexProgress({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      try {
        const updated = await buildIndex(todo[i], getProvider(), getModel());
        if (updated) await handleUpdate(updated);
      } catch {
        /* skip papers that fail to index */
      }
      setIndexProgress({ done: i + 1, total: todo.length });
    }
    setIndexProgress(null);
    setImportNote(`Indexed ${todo.length} paper(s)`);
  }, [papers, handleUpdate]);

  const handleDelete = useCallback(async (id: string) => {
    await deletePaper(id);
    setPapers((list) => list.filter((p) => p.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const openPaper = useCallback(
    (id: string) => {
      setActiveId(id);
      const now = new Date().toISOString();
      let updated: Paper | null = null;
      setPapers((list) => list.map((p) => (p.id === id ? (updated = { ...p, lastOpenedAt: now }) : p)));
      if (updated) {
        updatePaper(updated);
        ensureIndexed(updated); // continue/start background indexing (survives exit)
      }
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
    let updated: Paper | null = null;
    setPapers((list) =>
      list.map((p) => {
        if (p.id !== paperId) return p;
        updated = { ...p, highlights: p.highlights.map((h) => (h.id === highlightId ? { ...h, note } : h)) };
        return updated;
      })
    );
    if (updated) updatePaper(updated);
  }, []);

  const navigate = useCallback((v: View) => {
    setActiveId(null);
    setCategory(null);
    setView(v);
  }, []);

  const selectCategory = useCallback((c: string | null) => {
    setActiveId(null);
    setView("library");
    setCategory(c);
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
      />
    );
  } else if (view === "search") {
    main = <SearchView papers={papers} onOpen={openPaper} />;
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
  } else if (view === "canvas") {
    main = <GraphCanvas papers={papers} onOpen={openPaper} />;
  } else if (view === "timeline") {
    main = <Timeline papers={papers} onOpen={openPaper} />;
  } else if (view === "highlights") {
    main = <Highlights papers={papers} onOpen={openPaper} onUpdateNote={handleUpdateNote} />;
  } else if (view === "settings") {
    main = <SettingsView papers={papers} />;
  } else {
    main = (
      <Library
        papers={papers}
        activeCategory={category}
        importing={importing}
        importNote={importNote}
        indexProgress={indexProgress}
        onImport={handleImport}
        onImportUrl={handleImportUrl}
        onImportResearch={handleResearchImport}
        onIndexAll={handleIndexAll}
        onDismissNote={() => setImportNote(null)}
        onOpen={openPaper}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <div className="app">
      <Sidebar
        papers={papers}
        view={view}
        inReader={!!active}
        activeCategory={category}
        collapsed={!navOpen}
        onToggle={() => setNavOpen((o) => !o)}
        onNavigate={navigate}
        onSelectCategory={selectCategory}
      />
      <main className="main">{main}</main>
    </div>
  );
}
