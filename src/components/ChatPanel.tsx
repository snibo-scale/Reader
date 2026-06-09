import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatSession, Paper, Provider } from "../types";
import { askAi } from "../lib/api";
import { uid } from "../lib/util";
import { getModel, getProvider, withInstructions } from "../lib/settings";
import Markdown from "./Markdown";

interface Props {
  paper: Paper;
  paperText: string;
  seedContext: string;
  onConsumeSeed: () => void;
  onChange: (p: Paper) => void;
}

function sessionTitle(text: string): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ").slice(0, 7).join(" ");
  const title = words.length > 46 ? words.slice(0, 46) + "…" : words;
  return title || "New chat";
}

function upsert(list: ChatSession[], s: ChatSession): ChatSession[] {
  return list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [s, ...list];
}

export default function ChatPanel({ paper, paperText, seedContext, onConsumeSeed, onChange }: Props) {
  const sessions = paper.sessions ?? [];
  const [activeId, setActiveId] = useState<string | null>(() => {
    const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted[0]?.id ?? null;
  });
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>(getProvider());
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [ctx, setCtx] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  useEffect(() => {
    if (seedContext) {
      setCtx(seedContext);
      inputRef.current?.focus();
      onConsumeSeed();
    }
  }, [seedContext, onConsumeSeed]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    const now = new Date().toISOString();
    const context = ctx ?? paperText;

    const session = active ?? { id: uid(), name: "New chat", createdAt: now, updatedAt: now, messages: [] };
    const isFirst = session.messages.length === 0;
    const history = session.messages;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: q, model: provider, createdAt: now };
    const sessionAfterUser: ChatSession = {
      ...session,
      name: isFirst ? sessionTitle(q) : session.name,
      messages: [...session.messages, userMsg],
      updatedAt: now,
    };
    const paperAfterUser: Paper = { ...paper, sessions: upsert(sessions, sessionAfterUser) };
    setActiveId(session.id);
    onChange(paperAfterUser);
    setInput("");
    setBusy(true);
    setStreaming("");

    // Resume continuity: include the recent transcript so the model keeps context.
    const transcript = history
      .slice(-8)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    const prompt = transcript ? `Continue this conversation about the paper.\n\n${transcript}\n\nUser: ${q}` : q;

    let acc = "";
    try {
      await askAi(
        { paperId: paper.id, prompt: withInstructions(prompt), context, provider, model: getModel() },
        (e) => {
          if (e.event === "chunk") {
            acc += e.data.text;
            setStreaming(acc);
          } else if (e.event === "error") {
            acc += `\n\n⚠️ ${e.data.message}`;
            setStreaming(acc);
          }
        }
      );
    } catch (err) {
      acc += `\n\n⚠️ ${String(err)}`;
    }

    const aiMsg: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: acc.trim() || "(no output)",
      model: provider,
      createdAt: new Date().toISOString(),
    };
    const sessionFinal: ChatSession = {
      ...sessionAfterUser,
      messages: [...sessionAfterUser.messages, aiMsg],
      updatedAt: new Date().toISOString(),
    };
    onChange({ ...paperAfterUser, sessions: upsert(paperAfterUser.sessions, sessionFinal) });
    setStreaming("");
    setBusy(false);
    setCtx(null);
  };

  const newChat = () => {
    setActiveId(null);
    setStreaming("");
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="chat">
      <div className="chat-header">
        <div className="session-bar">
          <select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value || null)} title="Browse conversations">
            {activeId === null && <option value="">New chat</option>}
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="newchat" title="New conversation" onClick={newChat}>
            ＋
          </button>
        </div>
        <div className="provider">
          <button className={provider === "claude" ? "current" : ""} onClick={() => setProvider("claude")}>
            Claude
          </button>
          <button className={provider === "codex" ? "current" : ""} onClick={() => setProvider("codex")}>
            Codex
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !streaming && (
          <div className="chat-empty">
            Ask anything about “{paper.title}”. Select text in the PDF and hit <em>Ask AI</em> to focus on a passage.
            Each conversation is saved and named so you can return to it.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "You" : m.model}</div>
            <div className="msg-body">
              {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : m.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            <div className="msg-role">{provider}</div>
            <div className="msg-body">
              <Markdown>{streaming}</Markdown>
              <span className="cursor">▍</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {ctx && (
        <div className="ctx-chip">
          <span>
            Selection: “{ctx.slice(0, 90)}
            {ctx.length > 90 ? "…" : ""}”
          </span>
          <button onClick={() => setCtx(null)} title="Use whole paper instead">
            ✕
          </button>
        </div>
      )}

      <div className="chat-input">
        <textarea
          ref={inputRef}
          value={input}
          placeholder={busy ? "Thinking…" : "Ask a question…  (Enter to send)"}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
