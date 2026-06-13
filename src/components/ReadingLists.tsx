import { useRef, useState } from "react";
import type { Paper, ReadingList } from "../types";
import { formatAuthors } from "../lib/util";
import { openPaperWindow } from "../lib/window";

interface Props {
  papers: Paper[];
  lists: ReadingList[];
  onChangeLists: (next: ReadingList[]) => void;
  onOpen: (id: string) => void;
}

export default function ReadingLists({ papers, lists, onChangeLists, onOpen }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(lists[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const byId = new Map(papers.map((p) => [p.id, p] as const));
  // Keep selection valid as lists change (e.g. after a delete).
  const selected = lists.find((l) => l.id === selectedId) ?? lists[0] ?? null;

  const createList = () => {
    const name = newName.trim();
    if (!name) return;
    const list: ReadingList = {
      id: crypto.randomUUID(),
      name,
      paperIds: [],
      createdAt: new Date().toISOString(),
    };
    onChangeLists([...lists, list]);
    setSelectedId(list.id);
    setNewName("");
    setCreating(false);
  };

  const renameSelected = () => {
    const name = renameVal.trim();
    if (!selected || !name) {
      setRenaming(false);
      return;
    }
    onChangeLists(lists.map((l) => (l.id === selected.id ? { ...l, name } : l)));
    setRenaming(false);
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (!confirm(`Delete the list "${selected.name}"? The papers themselves are kept.`)) return;
    const next = lists.filter((l) => l.id !== selected.id);
    onChangeLists(next);
    setSelectedId(next[0]?.id ?? null);
  };

  const removeFromList = (paperId: string) => {
    if (!selected) return;
    onChangeLists(
      lists.map((l) =>
        l.id === selected.id ? { ...l, paperIds: l.paperIds.filter((id) => id !== paperId) } : l
      )
    );
  };

  const handleDrop = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === to || !selected) return;
    const next = [...selected.paperIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChangeLists(lists.map((l) => (l.id === selected.id ? { ...l, paperIds: next } : l)));
  };

  const rows = selected ? selected.paperIds.map((id) => byId.get(id)).filter(Boolean) as Paper[] : [];

  return (
    <div className="library">
      <header className="lib-header">
        <div className="crumbs">
          <strong>My Library</strong> <span className="sep">/</span> Reading Lists
        </div>
      </header>

      <div className="lists-layout">
        <aside className="lists-rail">
          {lists.map((l) => (
            <button
              key={l.id}
              className={"list-tab" + (selected?.id === l.id ? " current" : "")}
              onClick={() => setSelectedId(l.id)}
            >
              <span className="list-tab-name">{l.name}</span>
              <span className="list-tab-count">{l.paperIds.length}</span>
            </button>
          ))}
          {creating ? (
            <div className="list-new">
              <input
                autoFocus
                value={newName}
                placeholder="List name…"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createList();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
              />
            </div>
          ) : (
            <button className="list-add" onClick={() => setCreating(true)}>
              + New list
            </button>
          )}
        </aside>

        <section className="lists-main">
          {!selected ? (
            <div className="empty">
              <p>No reading lists yet.</p>
              <p className="muted">Create a list, then add papers to it from your library (the ⊕ on each card).</p>
            </div>
          ) : (
            <>
              <div className="list-head">
                {renaming ? (
                  <input
                    autoFocus
                    className="list-rename"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={renameSelected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") renameSelected();
                      if (e.key === "Escape") setRenaming(false);
                    }}
                  />
                ) : (
                  <h2
                    className="list-name"
                    title="Click to rename"
                    onClick={() => {
                      setRenameVal(selected.name);
                      setRenaming(true);
                    }}
                  >
                    {selected.name}
                  </h2>
                )}
                <div className="lib-actions">
                  <span className="muted">
                    {rows.length} paper{rows.length === 1 ? "" : "s"}
                    {rows.length > 1 ? " · drag to reorder" : ""}
                  </span>
                  <button className="ghost-btn" onClick={deleteSelected}>
                    Delete list
                  </button>
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="empty">
                  <p>This list is empty.</p>
                  <p className="muted">Add papers from your library with the ⊕ button on each card.</p>
                </div>
              ) : (
                <ol className="reading-list">
                  {rows.map((p, i) => (
                    <li
                      key={p.id}
                      className={"reading-row" + (overIndex === i ? " drag-over" : "")}
                      draggable
                      onDragStart={() => {
                        dragIndex.current = i;
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (overIndex !== i) setOverIndex(i);
                      }}
                      onDragLeave={() => {
                        if (overIndex === i) setOverIndex(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDrop(i);
                      }}
                      onDragEnd={() => {
                        dragIndex.current = null;
                        setOverIndex(null);
                      }}
                      onClick={() => onOpen(p.id)}
                    >
                      <span className="reading-handle" title="Drag to reorder">⠿</span>
                      <span className="reading-num">{i + 1}</span>
                      <div className="reading-main">
                        <div className="reading-title">{p.title}</div>
                        <div className="reading-author">{formatAuthors(p.authors)}</div>
                      </div>
                      <span className="reading-year">{p.year || "—"}</span>
                      <div className="reading-actions">
                        <button
                          className="reading-win"
                          title="Open in new window"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPaperWindow(p.id, p.title);
                          }}
                        >
                          ⧉
                        </button>
                        <button
                          className="reading-remove"
                          title="Remove from this list"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromList(p.id);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
