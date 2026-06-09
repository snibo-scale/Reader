# Reader

A local, UNMS-style research-paper reader that integrates with your local **Claude Code** and **Codex** CLIs. Import PDFs, read them with a selectable text layer and persistent highlights, then ask Claude or Codex about a selection or the whole paper — answers stream in from the CLI you're already authenticated with. No API keys, fully local.

## Stack

- **Tauri 2** (Rust) shell + **React + Vite** frontend
- **pdf.js** for rendering + text layer
- AI = the Rust backend spawns `claude -p` / `codex exec` as subprocesses and streams stdout to the UI over a Tauri `Channel`

## Prerequisites

- Node 18+ and Rust (stable) with the Tauri 2 system deps
- `claude` and/or `codex` CLIs installed and authenticated

## Setup

```bash
npm install
npm run icon      # generates app icons (one-time; needs the deps installed)
npm run tauri dev # launches the desktop app with hot reload
```

To build a distributable app:

```bash
npm run tauri build
```

## How it works

| Layer | File | Responsibility |
| --- | --- | --- |
| Library storage | `src-tauri/src/storage.rs` | Imports/copies PDFs into the app data dir, stores metadata + highlights + chat in `library.json` |
| AI integration | `src-tauri/src/ai.rs` | Resolves the `claude`/`codex` binary, spawns it, streams stdout chunks to the frontend |
| Reader UI | `src/components/Reader.tsx`, `PdfPage.tsx` | Renders pages, builds the selectable text layer, captures/persists highlights |
| Chat | `src/components/ChatPanel.tsx` | Sends the selection or full paper text as context, renders streamed answers |

Data lives in `~/Library/Application Support/com.local.reader/`.

### Changing the CLI invocation

The exact flags are in `src-tauri/src/ai.rs` (`ask_ai`):

- Claude: `claude -p "<prompt>"`
- Codex: `codex exec "<prompt>"`

Add `--model` from the UI provider toggle (currently sends the CLI default). If your installed CLI uses different flags, adjust them there — errors from the CLI (incl. stderr) surface directly in the chat panel.

## Roadmap (post-v1)

- Categories / drag-to-organize, real metadata extraction (title/authors/year from the PDF)
- `Discover` (arXiv search) and `Listen` (TTS) tabs
- Streaming via `claude --output-format stream-json` for token-level rendering + tool use
- Per-paper persistent chat sessions (resume a `claude`/`codex` session id)
- Expose the library as an MCP server so Claude Code can query across papers
