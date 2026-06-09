import { useMemo, useState } from "react";
import type { Paper } from "../types";
import { libraryContext, searchPapers } from "../lib/search";
import { askAi } from "../lib/api";
import { formatAuthors } from "../lib/util";
import { getInstructions, getModel, getProvider } from "../lib/settings";
import Markdown from "./Markdown";

export default function SearchView({ papers, onOpen }: { papers: Paper[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

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
          prompt: getInstructions()
            ? `Instructions: ${getInstructions()}\n\nUsing my research library, answer this question: ${question}\nCite the relevant paper titles in [square brackets]. If the library doesn't cover it, say so.`
            : `Using my research library, answer this question: ${question}\nCite the relevant paper titles in [square brackets]. If the library doesn't cover it, say so.`,
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
        {results.map(({ paper }) => (
          <button key={paper.id} className="result-row" onClick={() => onOpen(paper.id)}>
            <div className="result-main">
              <div className="result-title">{paper.title}</div>
              <div className="result-meta">
                {formatAuthors(paper.authors)}
                {paper.year ? ` · ${paper.year}` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
