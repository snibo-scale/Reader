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
import { buildIndex, needsIndexing } from "./lib/indexer";
import { getModel, getProvider } from "./lib/settings";
import Sidebar, { type View } from "./components/Sidebar";
import Library from "./components/Library";
import Reader from "./components/Reader";
import Discover from "./components/Discover";
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
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const importedOnce = useRef(false);

  const refresh = useCallback(async () => {
    setPapers(await listPapers());
  }, []);

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
    } finally {
      setImporting(false);
    }
  }, []);

  const handleImportUrl = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setImporting(true);
    try {
      const paper = await importFromUrl(url.trim());
      setPapers((prev) => [paper, ...prev]);
      setImportNote(`Added "${paper.title}"`);
    } catch (e) {
      setImportNote(String(e));
    } finally {
      setImporting(false);
    }
  }, []);

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
    const todo = papers.filter(needsIndexing);
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

  const openPaper = useCallback((id: string) => {
    setActiveId(id);
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
        onBack={() => setActiveId(null)}
        onChange={handleUpdate}
        onOpenPaper={openPaper}
      />
    );
  } else if (view === "search") {
    main = <SearchView papers={papers} onOpen={openPaper} />;
  } else if (view === "discover") {
    main = <Discover papers={papers} />;
  } else if (view === "canvas") {
    main = <GraphCanvas papers={papers} onOpen={openPaper} />;
  } else if (view === "timeline") {
    main = <Timeline papers={papers} onOpen={openPaper} />;
  } else if (view === "highlights") {
    main = <Highlights papers={papers} onOpen={openPaper} />;
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
