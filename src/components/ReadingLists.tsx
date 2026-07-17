import { useRef, useState } from "react";
import type { DragEvent } from "react";
import type { Paper, ReadingList } from "../types";
import { formatAuthors } from "../lib/util";
import { openPaperWindow } from "../lib/window";

// Insertion slot (0..n) from the cursor's position within the row it's over:
// top half → before the row, bottom half → after it. This is what makes drops
// land where the indicator line shows, symmetrically in both drag directions.
function slotOf(e: DragEvent, index: number) {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2 ? index + 1 : index;
}

// Move arr[from] to insertion slot (0..n). Returns the same array on a no-op.
function reorder<T>(arr: T[], from: number, slot: number): T[] {
  const to = slot > from ? slot - 1 : slot;
  if (Number.isNaN(from) || to === from) return arr;
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

// Where row j ends up if arr[from] is moved to insertion slot — the same
// permutation as reorder(), used to animate each row to its post-drop spot.
function finalIndex(j: number, from: number, slot: number): number {
  const to = slot > from ? slot - 1 : slot;
  if (j === from) return to;
  const jr = j > from ? j - 1 : j; // index after the dragged row is removed
  return jr >= to ? jr + 1 : jr; // then shifted down if at/after the insertion
}

// Row pitch (height + gap) measured from the live list, so transforms line up.
function rowPitch(list: HTMLElement | null): number {
  const kids = list?.children;
  if (!kids || kids.length === 0) return 0;
  if (kids.length >= 2) return (kids[1] as HTMLElement).offsetTop - (kids[0] as HTMLElement).offsetTop;
  return (kids[0] as HTMLElement).offsetHeight;
}

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
  // Papers drag: which row is held + where it'd insert (0..n). Others animate
  // to their post-drop spots so the rearrangement is visible on hover.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [rowSlot, setRowSlot] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const pitchRef = useRef(0);
  // Commit on dragend (always fires on the source), using the last hovered slot.
  // The drop zone is the whole section so the region below the last row counts.
  const slotRef = useRef<number | null>(null);
  // Rail (list tabs) still uses a simple insertion line.
  const [railSlot, setRailSlot] = useState<number | null>(null);

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

  // Insertion slot from the cursor's Y over the whole list, using stable row
  // pitch — independent of the live transforms, so hovering doesn't feed back.
  const slotFromCursor = (e: DragEvent) => {
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    const n = selected?.paperIds.length ?? 0;
    const raw = pitchRef.current ? Math.round((e.clientY - top) / pitchRef.current) : 0;
    return Math.max(0, Math.min(n, raw));
  };

  // Fired on the source when the drag ends (drop, ESC, or release outside).
  // Commit only if released within the section rect; otherwise treat as cancel.
  const endRowDrag = (from: number, e: DragEvent) => {
    const slot = slotRef.current;
    setDragFrom(null);
    setRowSlot(null);
    slotRef.current = null;
    // No bottom bound: the section is only content-tall, so releasing just
    // below the last row (to append) lands under it — still a valid drop.
    // Cancel only if released to the side (e.g. the rail) or above the list.
    const r = mainRef.current?.getBoundingClientRect();
    const inside = !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top;
    if (!inside || slot === null || !selected) return;
    const next = reorder(selected.paperIds, from, slot);
    if (next !== selected.paperIds)
      onChangeLists(lists.map((l) => (l.id === selected.id ? { ...l, paperIds: next } : l)));
  };

  const dropList = (e: DragEvent, index: number) => {
    const from = Number(e.dataTransfer.getData("text/plain"));
    setRailSlot(null);
    const next = reorder(lists, from, slotOf(e, index));
    if (next !== lists) onChangeLists(next);
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
          {lists.map((l, i) => (
            <div
              key={l.id}
              // A <div>, not <button>: WKWebView won't start an HTML5 drag from a
              // native button, so tabs wouldn't reorder. role/tabIndex keep it keyboard-usable.
              role="button"
              tabIndex={0}
              className={
                "list-tab" +
                (selected?.id === l.id ? " current" : "") +
                (railSlot === i ? " insert-top" : "") +
                (railSlot === lists.length && i === lists.length - 1 ? " insert-bottom" : "")
              }
              draggable
              onClick={() => setSelectedId(l.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(l.id);
                }
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                // WebKit/WKWebView treats a drag with no payload as invalid — it
                // forces the copy cursor and never fires drop. setData fixes both.
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const s = slotOf(e, i);
                if (railSlot !== s) setRailSlot(s);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropList(e, i);
              }}
              onDragEnd={() => setRailSlot(null)}
            >
              <span className="list-tab-name">{l.name}</span>
              <span className="list-tab-count">{l.paperIds.length}</span>
            </div>
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

        <section
          className="lists-main"
          ref={mainRef}
          onDragOver={(e) => {
            if (dragFrom === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const s = slotFromCursor(e);
            slotRef.current = s;
            if (rowSlot !== s) setRowSlot(s);
          }}
          onDrop={(e) => e.preventDefault()}
        >
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
                <ol className="reading-list" ref={listRef}>
                  {rows.map((p, i) => {
                    const active = dragFrom !== null && rowSlot !== null;
                    const shift = active ? (finalIndex(i, dragFrom, rowSlot) - i) * pitchRef.current : 0;
                    return (
                    <li
                      key={p.id}
                      className={"reading-row" + (i === dragFrom ? " dragging" : "")}
                      style={active ? { transform: `translateY(${shift}px)` } : undefined}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(i));
                        pitchRef.current = rowPitch(listRef.current);
                        slotRef.current = null;
                        setDragFrom(i);
                      }}
                      onDragEnd={(e) => endRowDrag(i, e)}
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
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
