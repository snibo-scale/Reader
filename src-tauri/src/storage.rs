use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Response;
use tauri::{Manager, State};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    pub page: u32,
    pub text: String,
    pub rects: Vec<Rect>,
    pub color: String,
    #[serde(default)]
    pub note: Option<String>,
    pub created_at: String,
    /// Char-offset anchor into the rendered markdown text (markdown docs only).
    #[serde(default)]
    pub start: Option<u32>,
    #[serde(default)]
    pub end: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndexCard {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub methods: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub contributions: Vec<String>,
    #[serde(default)]
    pub indexed_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub model: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub messages: Vec<ChatMessage>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub authors: String,
    #[serde(default)]
    pub year: String,
    #[serde(default)]
    pub arxiv_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub authors: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
    pub color: String,
    pub file_name: String,
    pub added_at: String,
    #[serde(default)]
    pub last_opened_at: Option<String>,
    /// ISO timestamp when marked read/done; None = unread.
    #[serde(default)]
    pub read_at: Option<String>,
    /// Scroll position in the reader as a 0..1 fraction; used to resume reading.
    #[serde(default)]
    pub reading_progress: Option<f64>,
    /// ISO timestamp when pinned; pinned papers sort to the top of the library.
    #[serde(default)]
    pub pinned_at: Option<String>,
    /// Manual position in the Home "continue reading" strip; None = pin/recency order.
    #[serde(default)]
    pub home_order: Option<i64>,
    /// "markdown" for imported webpages; None/absent = a PDF paper.
    #[serde(default)]
    pub kind: Option<String>,
    /// Legacy single-list position (v2.0-dev). Migrated into a named reading list
    /// on load, then cleared and never written again (skipped when None).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<i64>,
    #[serde(default)]
    pub source_key: Option<String>,
    /// SHA-256 of the stored PDF bytes, used to detect duplicate imports across
    /// every path (file, URL, arXiv, Research). Backfilled on load for older papers.
    #[serde(default)]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub index: Option<IndexCard>,
    #[serde(default)]
    pub references: Option<Vec<Reference>>,
    #[serde(default)]
    pub highlights: Vec<Highlight>,
    /// Free-form, paper-level notes not anchored to any highlight.
    #[serde(default)]
    pub notes: Option<String>,
    /// Legacy single conversation; migrated into `sessions` on load and then
    /// never written back (skipped when empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chat: Vec<ChatMessage>,
    #[serde(default)]
    pub sessions: Vec<ChatSession>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReadingList {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub paper_ids: Vec<String>,
    pub created_at: String,
}

fn legacy_session_name(msgs: &[ChatMessage]) -> String {
    let first = msgs
        .iter()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("Earlier conversation");
    let title = first.split_whitespace().take(7).collect::<Vec<_>>().join(" ");
    let title = if title.chars().count() > 46 {
        format!("{}…", title.chars().take(46).collect::<String>())
    } else {
        title
    };
    if title.is_empty() { "Earlier conversation".into() } else { title }
}

/// UTC now in the same format as JS `Date.toISOString()` ("…​.123Z"), so
/// timestamps written from Rust and from the frontend compare lexically.
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// SHA-256 of arbitrary bytes, as a lowercase hex string.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub struct Library {
    dir: PathBuf,
    papers: Vec<Paper>,
    lists: Vec<ReadingList>,
}

impl Library {
    pub fn load(dir: PathBuf) -> Self {
        let file = dir.join("library.json");
        let mut papers = std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<Paper>>(&s).ok())
            .unwrap_or_default();
        // Migrate any legacy single `chat` into a named session.
        for p in papers.iter_mut() {
            if p.sessions.is_empty() && !p.chat.is_empty() {
                let created = p.chat.first().map(|m| m.created_at.clone()).unwrap_or_default();
                let updated = p.chat.last().map(|m| m.created_at.clone()).unwrap_or_else(|| created.clone());
                let name = legacy_session_name(&p.chat);
                p.sessions.push(ChatSession {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    created_at: created,
                    updated_at: updated,
                    messages: std::mem::take(&mut p.chat),
                });
            }
        }

        let lists_file = dir.join("lists.json");
        let mut lists = std::fs::read_to_string(&lists_file)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<ReadingList>>(&s).ok())
            .unwrap_or_default();

        let mut lib = Library { dir, papers, lists: vec![] };

        // One-time migration: fold the legacy single starred list (`reading_order`)
        // into a named "Reading List", but only if no named lists exist yet.
        let has_legacy = lib.papers.iter().any(|p| p.reading_order.is_some());
        if lists.is_empty() && has_legacy {
            let mut starred: Vec<&Paper> = lib.papers.iter().filter(|p| p.reading_order.is_some()).collect();
            starred.sort_by_key(|p| p.reading_order.unwrap_or(0));
            let paper_ids = starred.iter().map(|p| p.id.clone()).collect();
            lists.push(ReadingList {
                id: uuid::Uuid::new_v4().to_string(),
                name: "Reading List".into(),
                paper_ids,
                created_at: now_iso(),
            });
        }
        // Clear the legacy field so it's dropped from library.json going forward.
        let had_legacy = has_legacy;
        for p in lib.papers.iter_mut() {
            p.reading_order = None;
        }

        lib.lists = lists;

        // Backfill content hashes for papers imported before hashing existed, so
        // duplicate detection works against the whole library.
        let papers_dir = lib.papers_dir();
        let mut backfilled = false;
        for p in lib.papers.iter_mut() {
            if p.content_hash.is_none() {
                if let Ok(bytes) = std::fs::read(papers_dir.join(&p.file_name)) {
                    p.content_hash = Some(sha256_hex(&bytes));
                    backfilled = true;
                }
            }
        }

        if had_legacy || backfilled {
            lib.save();
        }
        if had_legacy {
            lib.save_lists();
        }
        lib
    }

    /// The first existing paper matching a candidate import by the reliable signals:
    /// identical PDF bytes (content hash) or the same arXiv id (source key). Title is
    /// intentionally not matched here — file/URL imports often carry only a filename
    /// stem, which would cause false positives.
    fn find_duplicate(&self, hash: &str, source_key: Option<&str>) -> Option<&Paper> {
        self.papers.iter().find(|p| {
            if p.content_hash.as_deref() == Some(hash) {
                return true;
            }
            match (source_key, p.source_key.as_deref()) {
                (Some(k), Some(pk)) => !k.is_empty() && k == pk,
                _ => false,
            }
        })
    }

    pub fn save(&self) {
        if let Ok(s) = serde_json::to_string_pretty(&self.papers) {
            // Write-then-rename so a crash mid-write can't corrupt the library.
            let tmp = self.dir.join("library.json.tmp");
            let res = std::fs::write(&tmp, s)
                .and_then(|_| std::fs::rename(&tmp, self.dir.join("library.json")));
            if let Err(e) = res {
                eprintln!("failed to save library.json: {e}");
            }
        }
    }

    fn save_lists(&self) {
        if let Ok(s) = serde_json::to_string_pretty(&self.lists) {
            let tmp = self.dir.join("lists.json.tmp");
            let res = std::fs::write(&tmp, s)
                .and_then(|_| std::fs::rename(&tmp, self.dir.join("lists.json")));
            if let Err(e) = res {
                eprintln!("failed to save lists.json: {e}");
            }
        }
    }

    fn papers_dir(&self) -> PathBuf {
        self.dir.join("papers")
    }
}

const COLORS: &[&str] = &[
    "#dfeede", "#e9e2f5", "#f6e3d2", "#e3e9f6", "#f6e3e3", "#e3f0f6", "#efeede", "#e6e6e6",
];

#[tauri::command]
pub fn list_papers(state: State<'_, Mutex<Library>>) -> Vec<Paper> {
    let lib = state.lock().unwrap();
    let mut v = lib.papers.clone();
    // Most-recent activity first: last opened, falling back to date added.
    let recency = |p: &Paper| -> String {
        match &p.last_opened_at {
            Some(o) if *o > p.added_at => o.clone(),
            _ => p.added_at.clone(),
        }
    };
    v.sort_by_key(|p| std::cmp::Reverse(recency(p)));
    v
}

#[tauri::command]
pub fn import_paper(state: State<'_, Mutex<Library>>, path: String) -> Result<Paper, String> {
    let src = PathBuf::from(&path);
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.pdf");

    let bytes = std::fs::read(&src).map_err(|e| format!("read failed: {e}"))?;
    let hash = sha256_hex(&bytes);

    let mut lib = state.lock().unwrap();
    if let Some(dup) = lib.find_duplicate(&hash, None) {
        return Err(format!("Already in your library: \"{}\"", dup.title));
    }
    let papers_dir = lib.papers_dir();
    std::fs::create_dir_all(&papers_dir).map_err(|e| e.to_string())?;
    std::fs::copy(&src, papers_dir.join(&file_name)).map_err(|e| format!("copy failed: {e}"))?;

    let color = COLORS[lib.papers.len() % COLORS.len()].to_string();
    let paper = Paper {
        id,
        title: stem,
        authors: None,
        year: None,
        color,
        file_name,
        added_at: now_iso(),
        last_opened_at: None,
        read_at: None,
        reading_progress: None,
        pinned_at: None,
        home_order: None,
        kind: None,
        reading_order: None,
        source_key: None,
        content_hash: Some(hash),
        index: None,
        highlights: vec![],
        notes: None,
        chat: vec![],
        sessions: vec![],
        references: None,
    };
    lib.papers.push(paper.clone());
    lib.save();
    Ok(paper)
}

#[derive(serde::Deserialize)]
struct ResearchRow {
    title: Option<String>,
    year: Option<String>,
    keywords: Option<String>,
    ai_summary: Option<String>,
    file_path: Option<String>,
    authors: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub total: usize,
}

fn normalize_title(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

/// arXiv-style filename "2304.07193v2" -> dedupe key "2304.07193" (version stripped).
fn derive_source_key(file_path: &str) -> String {
    let stem = std::path::Path::new(file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if let Some(pos) = stem.rfind('v') {
        if pos > 0 && pos + 1 < stem.len() && stem[pos + 1..].chars().all(|c| c.is_ascii_digit()) {
            return stem[..pos].to_string();
        }
    }
    stem
}

/// Import papers from the un.ms "Research" app, de-duplicating by arXiv id / title.
/// Reads the app's SQLite store via the `sqlite3` CLI (no extra Rust dependency).
#[tauri::command]
pub fn import_from_research(state: State<'_, Mutex<Library>>) -> Result<ImportResult, String> {
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or("no home dir")?;
    let db = home.join("Library/Application Support/research.un.ms/data.db");
    if !db.exists() {
        return Err("Research (un.ms) data not found on this machine".into());
    }
    let sqlite = if std::path::Path::new("/usr/bin/sqlite3").exists() {
        "/usr/bin/sqlite3"
    } else {
        "sqlite3"
    };
    let query = "SELECT i.title AS title, CAST(i.year AS TEXT) AS year, i.keywords AS keywords, \
i.ai_summary AS ai_summary, a.file_path AS file_path, \
(SELECT group_concat(TRIM(IFNULL(au.first_name,'')||' '||IFNULL(au.last_name,'')), ', ') \
FROM items_authors ia JOIN authors au ON au.id=ia.author_id WHERE ia.item_id=i.id) AS authors \
FROM items i JOIN attachments a ON a.item_id=i.id AND a.type='application/pdf' \
WHERE i.deleted_at IS NULL;";

    let out = std::process::Command::new(sqlite)
        .arg("-json")
        .arg(&db)
        .arg(query)
        .output()
        .map_err(|e| format!("failed to run sqlite3: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let body = String::from_utf8_lossy(&out.stdout);
    let rows: Vec<ResearchRow> = if body.trim().is_empty() {
        vec![]
    } else {
        serde_json::from_str(&body).map_err(|e| format!("parse error: {e}"))?
    };

    let mut lib = state.lock().unwrap();
    std::fs::create_dir_all(lib.papers_dir()).ok();
    let mut keys: std::collections::HashSet<String> =
        lib.papers.iter().filter_map(|p| p.source_key.clone()).collect();
    let mut titles: std::collections::HashSet<String> =
        lib.papers.iter().map(|p| normalize_title(&p.title)).collect();
    let mut hashes: std::collections::HashSet<String> =
        lib.papers.iter().filter_map(|p| p.content_hash.clone()).collect();

    let total = rows.len();
    let mut imported = 0usize;
    let mut skipped = 0usize;

    for row in rows {
        let fp = match row.file_path.as_deref() {
            Some(p) if !p.is_empty() => p,
            _ => {
                skipped += 1;
                continue;
            }
        };
        if !std::path::Path::new(fp).exists() {
            skipped += 1;
            continue;
        }
        let key = derive_source_key(fp);
        let title = row.title.clone().unwrap_or_else(|| "Untitled".into());
        let ntitle = normalize_title(&title);
        let bytes = match std::fs::read(fp) {
            Ok(b) => b,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let hash = sha256_hex(&bytes);
        if hashes.contains(&hash)
            || (!key.is_empty() && keys.contains(&key))
            || (!ntitle.is_empty() && titles.contains(&ntitle))
        {
            skipped += 1;
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let file_name = format!("{id}.pdf");
        if std::fs::write(lib.papers_dir().join(&file_name), &bytes).is_err() {
            skipped += 1;
            continue;
        }

        let kw: Vec<String> = row
            .keywords
            .as_deref()
            .unwrap_or("")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let summary = row.ai_summary.clone().unwrap_or_default();
        let index = if !kw.is_empty() || !summary.is_empty() {
            Some(IndexCard {
                summary,
                keywords: kw,
                indexed_at: now_iso(),
                ..Default::default()
            })
        } else {
            None
        };
        let color = COLORS[lib.papers.len() % COLORS.len()].to_string();

        let paper = Paper {
            id,
            title,
            authors: row.authors.clone().filter(|s| !s.is_empty()),
            year: row.year.clone().filter(|s| !s.is_empty() && s != "0"),
            color,
            file_name,
            added_at: now_iso(),
            last_opened_at: None,
        read_at: None,
        reading_progress: None,
        pinned_at: None,
            home_order: None,
            kind: None,
            reading_order: None,
            source_key: if key.is_empty() { None } else { Some(key.clone()) },
            content_hash: Some(hash.clone()),
            index,
            highlights: vec![],
            notes: None,
            chat: vec![],
            sessions: vec![],
            references: None,
        };
        keys.insert(key);
        titles.insert(ntitle);
        hashes.insert(hash);
        lib.papers.push(paper);
        imported += 1;
    }
    lib.save();
    Ok(ImportResult { imported, skipped, total })
}

/// Extract an arXiv id from a URL (/abs/ID, /pdf/ID(.pdf)) or a bare id.
fn extract_arxiv_id(s: &str) -> Option<String> {
    for marker in ["/abs/", "/pdf/"] {
        if let Some(pos) = s.find(marker) {
            let id = s[pos + marker.len()..]
                .split(['?', '#', '/'])
                .next()
                .unwrap_or("")
                .trim_end_matches(".pdf");
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    let bare = s.trim();
    let looks_like_id = bare.len() >= 9
        && !bare.contains('/')
        && bare.contains('.')
        && bare.chars().next().is_some_and(|c| c.is_ascii_digit());
    looks_like_id.then(|| bare.to_string())
}

fn filename_title(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let seg = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let stem = seg.strip_suffix(".pdf").unwrap_or(seg);
    if stem.is_empty() {
        "Imported paper".to_string()
    } else {
        stem.to_string()
    }
}

/// Import a paper from a URL (arXiv link/id or a direct PDF link), de-duped by arXiv id.
#[tauri::command]
pub async fn import_from_url(state: State<'_, Mutex<Library>>, url: String) -> Result<Paper, String> {
    let input = url.trim().to_string();
    if input.is_empty() {
        return Err("Enter a URL".into());
    }
    let (pdf_url, source_key, title) = match extract_arxiv_id(&input) {
        Some(id) => {
            let key = id.split('v').next().unwrap_or(&id).to_lowercase();
            (format!("https://arxiv.org/pdf/{id}"), Some(key), format!("arXiv:{id}"))
        }
        None => (input.clone(), None, filename_title(&input)),
    };

    // Download with no lock held across the await.
    let client = reqwest::Client::builder()
        .user_agent("ReaderApp/0.1 (research reader)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&pdf_url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status().as_u16()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
        return Err("That URL didn't return a PDF".into());
    }

    let hash = sha256_hex(&bytes);
    let mut lib = state.lock().unwrap();
    if let Some(dup) = lib.find_duplicate(&hash, source_key.as_deref()) {
        return Err(format!("Already in your library: \"{}\"", dup.title));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.pdf");
    std::fs::create_dir_all(lib.papers_dir()).map_err(|e| e.to_string())?;
    std::fs::write(lib.papers_dir().join(&file_name), &bytes).map_err(|e| e.to_string())?;
    let color = COLORS[lib.papers.len() % COLORS.len()].to_string();

    let paper = Paper {
        id,
        title,
        authors: None,
        year: None,
        color,
        file_name,
        added_at: now_iso(),
        last_opened_at: None,
        read_at: None,
        reading_progress: None,
        pinned_at: None,
        home_order: None,
        kind: None,
        reading_order: None,
        source_key,
        content_hash: Some(hash),
        index: None,
        highlights: vec![],
        notes: None,
        chat: vec![],
        sessions: vec![],
        references: None,
    };
    lib.papers.push(paper.clone());
    lib.save();
    Ok(paper)
}

/// Fetch a webpage's raw HTML. The frontend runs Readability + Turndown on it to
/// produce markdown (done in the webview, where a DOM parser is available), then
/// calls `import_markdown`. Fetching here avoids the webview's CORS restrictions.
#[tauri::command]
pub async fn fetch_url(url: String) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Enter a URL".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ReaderApp")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Fetch failed: HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Store already-converted markdown (from `fetch_url` + frontend Readability/Turndown)
/// as a paper. Mirrors `import_from_url` but writes a `.md` file and marks `kind`.
#[tauri::command]
pub fn import_markdown(
    state: State<'_, Mutex<Library>>,
    title: String,
    markdown: String,
    url: String,
    author: Option<String>,
    year: Option<String>,
) -> Result<Paper, String> {
    let title = title.trim();
    let title = if title.is_empty() { "Untitled page" } else { title };
    let clean = |o: Option<String>| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let authors = clean(author);
    let year = clean(year);
    let source_key = {
        let u = url.trim();
        if u.is_empty() { None } else { Some(u.to_string()) }
    };
    let bytes = markdown.as_bytes();
    let hash = sha256_hex(bytes);
    let mut lib = state.lock().unwrap();
    if let Some(dup) = lib.find_duplicate(&hash, source_key.as_deref()) {
        return Err(format!("Already in your library: \"{}\"", dup.title));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.md");
    std::fs::create_dir_all(lib.papers_dir()).map_err(|e| e.to_string())?;
    std::fs::write(lib.papers_dir().join(&file_name), bytes).map_err(|e| e.to_string())?;
    let color = COLORS[lib.papers.len() % COLORS.len()].to_string();

    let paper = Paper {
        id,
        title: title.to_string(),
        authors,
        year,
        color,
        file_name,
        added_at: now_iso(),
        last_opened_at: None,
        read_at: None,
        reading_progress: None,
        pinned_at: None,
        home_order: None,
        kind: Some("markdown".into()),
        reading_order: None,
        source_key,
        content_hash: Some(hash),
        index: None,
        highlights: vec![],
        notes: None,
        chat: vec![],
        sessions: vec![],
        references: None,
    };
    lib.papers.push(paper.clone());
    lib.save();
    Ok(paper)
}

/// A portable backup: every paper (with its highlights, index/summary, references,
/// notes, and chat sessions) plus the reading lists. PDFs are NOT bundled — they're
/// redownloaded from arXiv on import, keyed by `source_key`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub version: u32,
    pub papers: Vec<Paper>,
    pub lists: Vec<ReadingList>,
}

/// Write the whole library (metadata + lists) to `path` as one JSON backup file.
#[tauri::command]
pub fn export_library(state: State<'_, Mutex<Library>>, path: String) -> Result<usize, String> {
    let lib = state.lock().unwrap();
    let backup = Backup {
        version: 1,
        papers: lib.papers.clone(),
        lists: lib.lists.clone(),
    };
    let s = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| format!("write failed: {e}"))?;
    Ok(lib.papers.len())
}

/// Restore from a backup file: redownload each paper's PDF from arXiv and re-attach
/// all its annotations/summaries/sessions, then merge the reading lists. Papers that
/// already exist (same PDF or arXiv id) or have no arXiv source are skipped.
// ponytail: redownloads from arXiv only; manual-file imports have no source_key and
// can't be recovered — bundle the PDFs into the export if that matters.
#[tauri::command]
pub async fn import_library(
    state: State<'_, Mutex<Library>>,
    path: String,
) -> Result<ImportResult, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))?;
    let backup: Backup =
        serde_json::from_str(&text).map_err(|e| format!("Not a valid backup file: {e}"))?;

    // Snapshot existing dedupe signals under a short lock (no lock held across downloads).
    let (papers_dir, mut hashes, mut keys) = {
        let lib = state.lock().unwrap();
        (
            lib.papers_dir(),
            lib.papers.iter().filter_map(|p| p.content_hash.clone()).collect::<std::collections::HashSet<_>>(),
            lib.papers.iter().filter_map(|p| p.source_key.clone()).collect::<std::collections::HashSet<_>>(),
        )
    };
    std::fs::create_dir_all(&papers_dir).ok();

    let client = reqwest::Client::builder()
        .user_agent("ReaderApp/0.1 (research reader)")
        .build()
        .map_err(|e| e.to_string())?;

    let total = backup.papers.len();
    let mut skipped = 0usize;
    let mut ready: Vec<Paper> = vec![];

    for mut p in backup.papers {
        let already = p.content_hash.as_deref().is_some_and(|h| hashes.contains(h))
            || p.source_key.as_deref().is_some_and(|k| !k.is_empty() && keys.contains(k));
        let key = match p.source_key.clone().filter(|k| !k.is_empty()) {
            Some(k) if !already => k,
            _ => {
                skipped += 1;
                continue;
            }
        };
        let url = format!("https://arxiv.org/pdf/{key}");
        let bytes = match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => match r.bytes().await {
                Ok(b) => b,
                Err(_) => { skipped += 1; continue; }
            },
            _ => { skipped += 1; continue; }
        };
        if bytes.len() < 5 || &bytes[..5] != b"%PDF-" {
            skipped += 1;
            continue;
        }
        let hash = sha256_hex(&bytes);
        let file_name = format!("{}.pdf", uuid::Uuid::new_v4());
        if std::fs::write(papers_dir.join(&file_name), &bytes).is_err() {
            skipped += 1;
            continue;
        }
        p.file_name = file_name;
        p.content_hash = Some(hash.clone());
        hashes.insert(hash);
        keys.insert(key);
        ready.push(p);
    }

    let mut lib = state.lock().unwrap();
    let imported = ready.len();
    lib.papers.extend(ready);
    let existing: std::collections::HashSet<String> = lib.lists.iter().map(|l| l.id.clone()).collect();
    let mut new_lists = false;
    for l in backup.lists {
        if !existing.contains(&l.id) {
            lib.lists.push(l);
            new_lists = true;
        }
    }
    lib.save();
    if new_lists {
        lib.save_lists();
    }
    Ok(ImportResult { imported, skipped, total })
}

/// One shared paper: its metadata + annotations plus the actual file bytes,
/// base64-encoded so the whole thing is a single self-contained JSON file.
/// Unlike a library backup this needs no arXiv redownload — PDFs and imported
/// webpages both travel with their content.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperFile {
    pub version: u32,
    pub paper: Paper,
    pub file_base64: String,
}

/// Write one paper (metadata, highlights, notes, sessions) with its file bytes
/// bundled to `path` as a shareable `.reader` file.
#[tauri::command]
pub fn export_paper(
    state: State<'_, Mutex<Library>>,
    id: String,
    path: String,
) -> Result<(), String> {
    use base64::Engine;
    let lib = state.lock().unwrap();
    let paper = lib.papers.iter().find(|p| p.id == id).ok_or("paper not found")?;
    let bytes = std::fs::read(lib.papers_dir().join(&paper.file_name))
        .map_err(|e| format!("read failed: {e}"))?;
    let bundle = PaperFile {
        version: 1,
        paper: paper.clone(),
        file_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    };
    let s = serde_json::to_string(&bundle).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

/// Import a shared `.reader` file: recover the file bytes and re-attach all its
/// annotations under a fresh id. Rejected if the same content is already present.
#[tauri::command]
pub fn import_paper_file(state: State<'_, Mutex<Library>>, path: String) -> Result<Paper, String> {
    use base64::Engine;
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))?;
    let bundle: PaperFile =
        serde_json::from_str(&text).map_err(|e| format!("Not a valid shared paper: {e}"))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bundle.file_base64.as_bytes())
        .map_err(|e| format!("corrupt file data: {e}"))?;
    let hash = sha256_hex(&bytes);

    let mut paper = bundle.paper;
    // Preserve the extension (.pdf / .md) so the reader picks the right renderer.
    let ext = std::path::Path::new(&paper.file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("pdf");

    let mut lib = state.lock().unwrap();
    if let Some(dup) = lib.find_duplicate(&hash, paper.source_key.as_deref()) {
        return Err(format!("Already in your library: \"{}\"", dup.title));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.{ext}");
    std::fs::create_dir_all(lib.papers_dir()).map_err(|e| e.to_string())?;
    std::fs::write(lib.papers_dir().join(&file_name), &bytes).map_err(|e| e.to_string())?;

    // Fresh identity + local-only view state; annotations ride along unchanged.
    paper.id = id;
    paper.file_name = file_name;
    paper.color = COLORS[lib.papers.len() % COLORS.len()].to_string();
    paper.added_at = now_iso();
    paper.last_opened_at = None;
    paper.reading_progress = None;
    paper.pinned_at = None;
    paper.home_order = None;
    paper.content_hash = Some(hash);
    lib.papers.push(paper.clone());
    lib.save();
    Ok(paper)
}

#[tauri::command]
pub fn read_pdf_bytes(state: State<'_, Mutex<Library>>, id: String) -> Result<Response, String> {
    let lib = state.lock().unwrap();
    let paper = lib
        .papers
        .iter()
        .find(|p| p.id == id)
        .ok_or("paper not found")?;
    let bytes = std::fs::read(lib.papers_dir().join(&paper.file_name)).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

// Generation counter for debounced saves: each update bumps it, and a scheduled
// save only writes if no newer update has arrived in the meantime.
static SAVE_GEN: AtomicU64 = AtomicU64::new(0);

/// Persist `library.json` after ~500ms of quiet instead of on every mutation —
/// highlight/note edits fire update_paper per keystroke and each save rewrites
/// the whole file. A final save on app exit flushes anything still pending.
/// ponytail: 500ms debounce, a hard crash loses at most the last 500ms of edits.
fn schedule_save(app: tauri::AppHandle) {
    let gen = SAVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if SAVE_GEN.load(Ordering::SeqCst) == gen {
            app.state::<Mutex<Library>>().lock().unwrap().save();
        }
    });
}

#[tauri::command]
pub fn update_paper(
    app: tauri::AppHandle,
    state: State<'_, Mutex<Library>>,
    paper: Paper,
) -> Result<(), String> {
    let mut lib = state.lock().unwrap();
    match lib.papers.iter_mut().find(|p| p.id == paper.id) {
        Some(slot) => {
            *slot = paper;
            drop(lib);
            schedule_save(app);
            Ok(())
        }
        None => Err("paper not found".into()),
    }
}

#[tauri::command]
pub fn list_reading_lists(state: State<'_, Mutex<Library>>) -> Vec<ReadingList> {
    state.lock().unwrap().lists.clone()
}

/// Overwrite the whole reading-list collection in one atomic write. The frontend
/// owns list logic (create/rename/reorder/membership); this just persists the result.
#[tauri::command]
pub fn save_reading_lists(state: State<'_, Mutex<Library>>, lists: Vec<ReadingList>) -> Result<(), String> {
    let mut lib = state.lock().unwrap();
    lib.lists = lists;
    lib.save_lists();
    Ok(())
}

#[tauri::command]
pub fn delete_paper(state: State<'_, Mutex<Library>>, id: String) -> Result<(), String> {
    let mut lib = state.lock().unwrap();
    if let Some(pos) = lib.papers.iter().position(|p| p.id == id) {
        let file = lib.papers_dir().join(&lib.papers[pos].file_name);
        let _ = std::fs::remove_file(file);
        lib.papers.remove(pos);
        lib.save();
        // Prune the deleted paper from every reading list.
        let mut changed = false;
        for list in lib.lists.iter_mut() {
            let before = list.paper_ids.len();
            list.paper_ids.retain(|pid| pid != &id);
            changed |= list.paper_ids.len() != before;
        }
        if changed {
            lib.save_lists();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // A backup must round-trip every paper field we care about recovering:
    // highlights, index/summary, references, notes, and chat sessions. If serde
    // drops any of these, restore silently loses data — this catches that.
    #[test]
    fn backup_roundtrip_preserves_annotations() {
        let paper = Paper {
            id: "p1".into(),
            title: "T".into(),
            authors: Some("A".into()),
            year: Some("2024".into()),
            color: "#fff".into(),
            file_name: "p1.pdf".into(),
            added_at: "2024-01-01T00:00:00.000Z".into(),
            last_opened_at: None,
            read_at: None,
            reading_progress: None,
            pinned_at: None,
            home_order: None,
            kind: None,
            reading_order: None,
            source_key: Some("2401.00001".into()),
            content_hash: Some("abc".into()),
            index: Some(IndexCard { summary: "sum".into(), ..Default::default() }),
            references: Some(vec![Reference {
                title: "R".into(), authors: "".into(), year: "".into(), arxiv_id: "".into(),
            }]),
            highlights: vec![Highlight {
                id: "h1".into(), page: 1, text: "hi".into(), rects: vec![],
                color: "#ff0".into(), note: Some("n".into()),
                created_at: "2024-01-01T00:00:00.000Z".into(),
            }],
            notes: Some("paper note".into()),
            chat: vec![],
            sessions: vec![ChatSession {
                id: "s1".into(), name: "chat".into(),
                created_at: "x".into(), updated_at: "y".into(),
                messages: vec![ChatMessage {
                    id: "m1".into(), role: "user".into(), content: "q".into(),
                    model: "claude".into(), created_at: "z".into(),
                }],
            }],
        };
        let backup = Backup {
            version: 1,
            papers: vec![paper],
            lists: vec![ReadingList {
                id: "l1".into(), name: "L".into(),
                paper_ids: vec!["p1".into()], created_at: "x".into(),
            }],
        };
        let json = serde_json::to_string(&backup).unwrap();
        let back: Backup = serde_json::from_str(&json).unwrap();
        let p = &back.papers[0];
        assert_eq!(p.index.as_ref().unwrap().summary, "sum");
        assert_eq!(p.highlights[0].note.as_deref(), Some("n"));
        assert_eq!(p.notes.as_deref(), Some("paper note"));
        assert_eq!(p.sessions[0].messages[0].content, "q");
        assert_eq!(p.references.as_ref().unwrap()[0].title, "R");
        assert_eq!(back.lists[0].paper_ids, vec!["p1".to_string()]);
    }
}
