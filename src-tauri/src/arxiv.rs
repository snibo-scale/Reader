use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArxivPaper {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub authors: Vec<String>,
    pub year: String,
    pub link: String,
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn between<'a>(s: &'a str, a: &str, b: &str) -> Option<&'a str> {
    let i = s.find(a)? + a.len();
    let j = s[i..].find(b)?;
    Some(&s[i..i + j])
}

fn clean(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_atom(body: &str) -> Vec<ArxivPaper> {
    let mut out = Vec::new();
    for entry in body.split("<entry>").skip(1) {
        let title = between(entry, "<title>", "</title>").map(clean).unwrap_or_default();
        let summary = between(entry, "<summary>", "</summary>").map(clean).unwrap_or_default();
        let id_raw = between(entry, "<id>", "</id>").unwrap_or("").trim().to_string();
        let year = between(entry, "<published>", "</published>")
            .unwrap_or("")
            .chars()
            .take(4)
            .collect::<String>();
        let mut authors = Vec::new();
        for seg in entry.split("<author>").skip(1) {
            if let Some(n) = between(seg, "<name>", "</name>") {
                authors.push(clean(n));
            }
        }
        let id = id_raw.rsplit('/').next().unwrap_or("").to_string();
        if !title.is_empty() {
            out.push(ArxivPaper { id, title, summary, authors, year, link: id_raw });
        }
    }
    out
}

#[tauri::command]
pub async fn arxiv_search(query: String, max: Option<u32>) -> Result<Vec<ArxivPaper>, String> {
    let max = max.unwrap_or(6).min(20);
    // arXiv now redirects HTTP -> HTTPS, so use HTTPS directly (reqwest + rustls).
    let url = format!(
        "https://export.arxiv.org/api/query?search_query=all:{}&start=0&max_results={}&sortBy=relevance",
        percent_encode(&query),
        max
    );
    let client = reqwest::Client::builder()
        .user_agent("ReaderApp/0.1 (research reader)")
        .build()
        .map_err(|e| e.to_string())?;
    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_atom(&body))
}
