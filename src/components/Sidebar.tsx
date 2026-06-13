import Logo from "./Logo";

export type View = "library" | "all" | "reading" | "search" | "discover" | "timeline" | "highlights" | "settings";

interface Props {
  view: View;
  inReader: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (v: View) => void;
}

export default function Sidebar({ view, inReader, collapsed, onToggle, onNavigate }: Props) {
  const inLibrary = !inReader && view === "library";

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <Logo size={24} />
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
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <Logo size={24} />
            <span className="brand-name">Reader</span>
          </div>
          <button className="nav-toggle" onClick={onToggle} title="Hide sidebar">
            «
          </button>
        </div>
        <nav className="nav-top">
          {item("library", "Recent", inLibrary)}
          {item("all", "All Papers", !inReader && view === "all")}
          {item("reading", "★ Reading Lists", !inReader && view === "reading")}
          {item("search", "Search", !inReader && view === "search")}
          {item("discover", "Discover", !inReader && view === "discover")}
          {item("timeline", "Timeline", !inReader && view === "timeline")}
          {item("highlights", "Highlights", !inReader && view === "highlights")}
        </nav>
      </div>

      <div className="sidebar-footer">{item("settings", "⚙ Settings", !inReader && view === "settings")}</div>
    </aside>
  );
}
