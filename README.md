# Reader

A local research-paper reader that integrates with your local **Claude Code** and **Codex** CLIs. Import PDFs (file, URL, or arXiv id), read them with a selectable text layer and persistent highlights, then ask Claude or Codex about a selection or the whole paper — answers stream token-by-token from the CLI you're already authenticated with. No API keys, fully local.

## Features

- **Library** — card grid with tag tints, recent/all views, read/unread state, arXiv search, dedup by content hash + arXiv id, auto-import from the un.ms Research app
- **Reader** — continuous scroll, selectable text, highlights with notes, zoom, page tint/dark mode, heading-based table of contents, present-highlights slideshow, per-paper windows
- **AI chat** — multiple named persistent sessions per paper; ask about a selection or the whole paper; token-level streaming (claude `stream-json`)
- **Index cards** — LLM-generated summary, topics, methods, keywords, canonical tags; editable prompt templates in Settings
- **References** — extracted from the References section, cross-marked against your library, one-click import of cited arXiv papers
- **Search** — weighted lexical search across the library, plus "ask across your library" (⌘↵)
- **Discover** — LLM-suggested arXiv queries from your reading profile
- **Timeline / Highlights / Reading lists** — papers by year, all highlights in one view, named orderable lists
- **Backup** — export/import `library.json`; arXiv PDFs are re-downloaded on restore (manually imported PDFs are not bundled)

## Stack

- **Tauri 2** (Rust) shell + **React + Vite** frontend
- **pdf.js** for rendering + text layer
- AI = the Rust backend spawns `claude -p` / `codex exec` as subprocesses and streams output to the UI over a Tauri `Channel`

## Prerequisites

- Node 18+ and Rust (stable) with the Tauri 2 system deps
- `claude` and/or `codex` CLIs installed and authenticated

## Setup

```bash
npm install
npm run tauri dev # launches the desktop app with hot reload
```

App icons are committed. To regenerate them after editing the logo, update
`assets/icon-source.svg`, export it to `assets/icon-source.png` (1024×1024),
then run `npm run icon`.

To build a distributable app:

```bash
npm run tauri build
```

Tests: `npm test` (frontend) and `cargo test` in `src-tauri/` (backend).

## Installing a release build (macOS)

The app isn't code-signed with an Apple Developer certificate, so macOS
Gatekeeper blocks it on first launch with *"Apple could not guarantee this
software is free of malware."* This is expected for unsigned apps downloaded
from the internet — not a sign anything is wrong.

After copying `Reader.app` to `/Applications`, clear the quarantine flag:

```bash
xattr -cr /Applications/Reader.app
```

Then open it normally. (Alternatively: right-click the app → **Open** → **Open**.)

<!-- OLD-VERSIONS:START -->
## Older versions

Older major versions are no longer published as prebuilt binaries (to keep release storage small). Build one from source by checking out the last tag of that major:

- `git checkout v2.9.0 && npm ci && npm run tauri build` — latest v2.x
- `git checkout v3.0.0 && npm ci && npm run tauri build` — latest v3.x
<!-- OLD-VERSIONS:END -->

## How it works

| Layer | File | Responsibility |
| --- | --- | --- |
| Library storage | `src-tauri/src/storage.rs` | Imports/copies PDFs into the app data dir; stores metadata, highlights, notes, index cards, references, and chat sessions in `library.json` (debounced atomic writes) |
| AI integration | `src-tauri/src/ai.rs` | Resolves the `claude`/`codex` binary, spawns it, streams text deltas to the frontend |
| Reader UI | `src/components/Reader.tsx`, `PdfPage.tsx` | Renders pages (windowed via IntersectionObserver), builds the selectable text layer, captures/persists highlights |
| PDF cache | `src/lib/pdfCache.ts` | LRU of parsed docs + extracted text/headings shared by the reader and indexer; headings persist across sessions |
| Indexing | `src/lib/indexer.ts` | Background LLM analysis + reference extraction, running only the missing steps per paper |
| Chat | `src/components/ChatPanel.tsx` | Sends the selection or full paper text as context, renders streamed answers |

Data lives in `~/Library/Application Support/com.local.reader/` (`library.json`, `lists.json`, `papers/<uuid>.pdf`).

### Changing the CLI invocation

The exact flags are in `src-tauri/src/ai.rs`:

- Claude: `claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages` (chat) or plain `claude -p` (indexing)
- Codex: `codex exec "<prompt>"`

The Settings model picker adds `--model`. If your installed CLI uses different flags, adjust them there — errors from the CLI (incl. stderr) surface directly in the chat panel.

## Roadmap

- `Listen` (TTS) tab
- Resume a `claude`/`codex` session id instead of resending the transcript
- Expose the library as an MCP server so Claude Code can query across papers
- Bundle PDF bytes in backups so manually imported papers survive restore
