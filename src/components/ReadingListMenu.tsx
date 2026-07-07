import { useState } from "react";
import type { CSSProperties } from "react";
import type { ReadingList } from "../types";

interface Props {
  lists: ReadingList[];
  paperId: string;
  onChangeLists: (next: ReadingList[]) => void;
  onClose?: () => void;
  autoFocusNewList?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function ReadingListMenu({
  lists,
  paperId,
  onChangeLists,
  onClose,
  autoFocusNewList = false,
  className = "",
  style,
}: Props) {
  const [newName, setNewName] = useState("");

  const toggleInList = (listId: string) => {
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

  const createListWith = () => {
    const name = newName.trim();
    if (!name) return;
    onChangeLists([
      ...lists,
      {
        id: crypto.randomUUID(),
        name,
        paperIds: [paperId],
        createdAt: new Date().toISOString(),
      },
    ]);
    setNewName("");
  };

  return (
    <div className={`list-menu${className ? ` ${className}` : ""}`} style={style} onClick={(e) => e.stopPropagation()}>
      <div className="list-menu-title">Add to list</div>
      {lists.length === 0 && <div className="list-menu-empty">No lists yet</div>}
      {lists.map((l) => {
        const has = l.paperIds.includes(paperId);
        return (
          <button key={l.id} className="list-menu-item" onClick={() => toggleInList(l.id)}>
            <span className="list-menu-check">{has ? "✓" : ""}</span>
            <span className="list-menu-name">{l.name}</span>
          </button>
        );
      })}
      <div className="list-menu-new">
        <input
          autoFocus={autoFocusNewList}
          value={newName}
          placeholder="New list…"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createListWith();
            if (e.key === "Escape") onClose?.();
          }}
        />
        <button onClick={createListWith} disabled={!newName.trim()}>
          +
        </button>
      </div>
    </div>
  );
}
