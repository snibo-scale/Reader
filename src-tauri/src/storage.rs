use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::State;

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
    /// Legacy single-list position (v2.0-dev). Migrated into a named reading list
    /// on load, then cleared and never written again (skipped when None).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<i64>,
    #[serde(default)]
    pub source_key: Option<String>,
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
        if had_legacy {
            lib.save();
            lib.save_lists();
        }
        lib
    }

    fn save(&self) {
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

    let mut lib = state.lock().unwrap();
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
        reading_order: None,
        source_key: None,
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
        if (!key.is_empty() && keys.contains(&key)) || (!ntitle.is_empty() && titles.contains(&ntitle)) {
            skipped += 1;
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let file_name = format!("{id}.pdf");
        if std::fs::copy(fp, lib.papers_dir().join(&file_name)).is_err() {
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
            reading_order: None,
            source_key: if key.is_empty() { None } else { Some(key.clone()) },
            index,
            highlights: vec![],
            notes: None,
            chat: vec![],
            sessions: vec![],
            references: None,
        };
        keys.insert(key);
        titles.insert(ntitle);
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

    let mut lib = state.lock().unwrap();
    if let Some(k) = &source_key {
        if lib.papers.iter().any(|p| p.source_key.as_deref() == Some(k.as_str())) {
            return Err("Already in your library".into());
        }
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
        reading_order: None,
        source_key,
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

#[tauri::command]
pub fn update_paper(state: State<'_, Mutex<Library>>, paper: Paper) -> Result<(), String> {
    let mut lib = state.lock().unwrap();
    match lib.papers.iter_mut().find(|p| p.id == paper.id) {
        Some(slot) => {
            *slot = paper;
            lib.save();
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
