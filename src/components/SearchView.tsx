import { useEffect, useMemo, useState } from "react";
import type { Paper, ReadingList } from "../types";
import { libraryContext, searchPapers } from "../lib/search";
import { askAi } from "../lib/api";
import { formatAuthors } from "../lib/util";
import { getModel, getProvider, withInstructions } from "../lib/settings";
import Markdown from "./Markdown";

interface Props {
  papers: Paper[];
  onOpen: (id: string) => void;
  lists: ReadingList[];
  onChangeLists: (next: ReadingList[]) => void;
}

export default function SearchView({ papers, onOpen, lists, onChangeLists }: Props) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  // Right-click context menu for adding a result to a reading list.
  const [menu, setMenu] = useState<{ paperId: string; x: number; y: number } | null>(null);
  const [newName, setNewName] = useState("");

  const closeMenu = () => {
    setMenu(null);
    setNewName("");
  };

  // Dismiss the menu on an outside click, scroll, or Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".list-menu")) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const toggleInList = (listId: string, paperId: string) => {
    onChangeLists(
      lists.map((l) => {
        if (l.id !== listId) return l;
        const has = l.paperIds.includes(paperId);
        return {
          ...l,
          paperIds: has ? l.paperIds.filter((id) => id !== paperId) : [...l.paperIds, paperId],
        };
      })
    );
  };

  const createListWith = (paperId: string) => {
    const name = newName.trim();
    if (!name) return;
    const list: ReadingList = {
      id: crypto.randomUUID(),
      name,
      paperIds: [paperId],
      createdAt: new Date().toISOString(),
    };
    onChangeLists([...lists, list]);
    setNewName("");
  };

  const results = useMemo(() => (q.trim() ? searchPapers(papers, q) : []), [papers, q]);
  const indexedCount = papers.filter((p) => p.index).length;

  const ask = async () => {
    const question = q.trim();
    if (!question || asking) return;
    setAsking(true);
    setAnswer("");
    const ctx = libraryContext(papers);
    let acc = "";
    try {
      await askAi(
        {
          paperId: "",
          prompt: withInstructions(
            `Using my research library, answer this question: ${question}\nCite the relevant paper titles in [square brackets]. If the library doesn't cover it, say so.`
          ),
          context: ctx,
          provider: getProvider(),
          model: getModel(),
        },
        (e) => {
          if (e.event === "chunk") {
            acc += e.data.text;
            setAnswer(acc);
          } else if (e.event === "error") {
            acc += `\n\n⚠️ ${e.data.message}`;
            setAnswer(acc);
          }
        }
      );
    } catch (err) {
      acc += `\n\n⚠️ ${String(err)}`;
    }
    setAnswer(acc.trim() || "(no output)");
    setAsking(false);
  };

  return (
    <div className="searchview">
      <header className="lib-header">
        <div className="crumbs">
          <strong>Search</strong> <span className="sep">/</span> {papers.length} papers · {indexedCount} indexed
        </div>
      </header>

      <div className="search-bar">
        <input
          autoFocus
          value={q}
          placeholder="Search title, author, topic, keyword…  (⌘↵ to ask across your library)"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
          }}
        />
        <button className="add-btn" onClick={ask} disabled={asking || !q.trim()}>
          {asking ? "Asking…" : "✦ Ask across library"}
        </button>
      </div>

      {answer && (
        <div className="qa-answer">
          <div className="qa-head">Answer{asking && <span className="cursor">▍</span>}</div>
          <div className="qa-body">
            <Markdown>{answer}</Markdown>
          </div>
        </div>
      )}

      <div className="search-results">
        {q.trim() && results.length === 0 && !answer && (
          <div className="empty">
            <p>No matches for "{q}".</p>
          </div>
        )}
        {results.map(({ paper }) => {
          const inAnyList = lists.some((l) => l.paperIds.includes(paper.id));
          return (
            <button
              key={paper.id}
              className="result-row"
              onClick={() => onOpen(paper.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setNewName("");
                setMenu({ paperId: paper.id, x: e.clientX, y: e.clientY });
              }}
            >
              <div className="result-main">
                <div className="result-title">
                  {inAnyList && <span className="result-star" title="In a reading list">★</span>}
                  {paper.title}
                </div>
                <div className="result-meta">
                  {formatAuthors(paper.authors)}
                  {paper.year ? ` · ${paper.year}` : ""}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {menu && (
        <div
          className="list-menu list-menu-floating"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="list-menu-title">Add to list</div>
          {lists.length === 0 && <div className="list-menu-empty">No lists yet</div>}
          {lists.map((l) => {
            const has = l.paperIds.includes(menu.paperId);
            return (
              <button
                key={l.id}
                className="list-menu-item"
                onClick={() => toggleInList(l.id, menu.paperId)}
              >
                <span className="list-menu-check">{has ? "✓" : ""}</span>
                <span className="list-menu-name">{l.name}</span>
              </button>
            );
          })}
          <div className="list-menu-new">
            <input
              autoFocus
              value={newName}
              placeholder="New list…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createListWith(menu.paperId);
                if (e.key === "Escape") closeMenu();
              }}
            />
            <button onClick={() => createListWith(menu.paperId)} disabled={!newName.trim()}>
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
