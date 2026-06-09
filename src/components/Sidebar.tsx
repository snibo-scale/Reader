import type { Paper } from "../types";

export type View = "library" | "search" | "discover" | "canvas" | "timeline" | "highlights" | "settings";

interface Props {
  papers: Paper[];
  view: View;
  inReader: boolean;
  activeCategory: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (v: View) => void;
  onSelectCategory: (category: string | null) => void;
}

export default function Sidebar({ view, inReader, activeCategory, collapsed, onToggle, onNavigate }: Props) {
  const inLibrary = !inReader && view === "library";

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <button className="nav-toggle" onClick={onToggle} title="Show sidebar">
          »
        </button>
      </aside>
    );
  }

  const item = (v: View, label: string, isCurrent: boolean) => (
    <button className={"nav-item" + (isCurrent ? " current" : "")} onClick={() => onNavigate(v)}>
      {label}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="nav-toggle" onClick={onToggle} title="Hide sidebar">
          «
        </button>
        <nav className="nav-top">
          {item("library", "Recent", inLibrary && !activeCategory)}
          {item("search", "Search", !inReader && view === "search")}
          {item("discover", "Discover", !inReader && view === "discover")}
          {item("canvas", "Canvas", !inReader && view === "canvas")}
          {item("timeline", "Timeline", !inReader && view === "timeline")}
          {item("highlights", "Highlights", !inReader && view === "highlights")}
        </nav>
      </div>

      <div className="sidebar-footer">{item("settings", "⚙ Settings", !inReader && view === "settings")}</div>
    </aside>
  );
}
