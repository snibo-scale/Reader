//! Push the library's arXiv ids into alphaXiv reading-status folders via its MCP
//! server, so the alphaXiv mobile app mirrors Reader's library.
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

const MCP: &str = "https://api.alphaxiv.org/mcp/v1";

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub synced: usize,
    pub not_found: Vec<String>,
}

struct Mcp {
    client: reqwest::Client,
    key: String,
    session: Option<String>,
    next_id: u64,
}

impl Mcp {
    async fn rpc(&mut self, method: &str, params: Value, notify: bool) -> Result<Value, String> {
        let mut body = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        if !notify {
            self.next_id += 1;
            body["id"] = json!(self.next_id);
        }
        let mut req = self
            .client
            .post(MCP)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .bearer_auth(&self.key)
            .body(body.to_string());
        if let Some(s) = &self.session {
            req = req.header("Mcp-Session-Id", s);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if let Some(s) = resp.headers().get("Mcp-Session-Id").and_then(|v| v.to_str().ok()) {
            self.session = Some(s.to_string());
        }
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if status.as_u16() == 401 {
            return Err("alphaXiv rejected the API key".into());
        }
        if !status.is_success() {
            return Err(format!("alphaXiv HTTP {}: {}", status.as_u16(), text.chars().take(200).collect::<String>()));
        }
        if notify {
            return Ok(Value::Null);
        }
        // Streamable HTTP may answer as plain JSON or as SSE `data:` lines.
        let raw = if text.trim_start().starts_with('{') {
            text.trim().to_string()
        } else {
            text.lines()
                .filter_map(|l| l.strip_prefix("data:"))
                .last()
                .ok_or("empty response from alphaXiv")?
                .trim()
                .to_string()
        };
        let msg: Value = serde_json::from_str(&raw).map_err(|e| format!("bad response: {e}"))?;
        if let Some(err) = msg.get("error") {
            return Err(format!("{method}: {err}"));
        }
        Ok(msg["result"].clone())
    }

    async fn call(&mut self, tool: &str, args: Value) -> Result<Value, String> {
        let res = self.rpc("tools/call", json!({ "name": tool, "arguments": args }), false).await?;
        if res["isError"].as_bool().unwrap_or(false) {
            return Err(format!("{tool} failed: {res}"));
        }
        if let Some(sc) = res.get("structuredContent") {
            return Ok(sc.clone());
        }
        let text: String = res["content"]
            .as_array()
            .map(|a| a.iter().filter_map(|c| c["text"].as_str()).collect())
            .unwrap_or_default();
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }
}

/// `buckets` maps an alphaXiv default folder name ("Want to read" / "Reading" /
/// "Completed") to the arXiv ids that belong in it.
#[tauri::command]
pub async fn alphaxiv_sync(key: String, buckets: HashMap<String, Vec<String>>) -> Result<SyncReport, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Add your alphaXiv API key in Settings first".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("ReaderApp (alphaXiv sync)")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let mut mcp = Mcp { client, key, session: None, next_id: 0 };

    mcp.rpc(
        "initialize",
        json!({ "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": { "name": "reader", "version": "1" } }),
        false,
    )
    .await?;
    mcp.rpc("notifications/initialized", json!({}), true).await?;

    let lib = mcp.call("list_library", json!({})).await?;
    let folders: HashMap<String, String> = lib["folders"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|f| Some((f["name"].as_str()?.to_string(), f["folder_id"].as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();

    let mut report = SyncReport::default();
    for (name, ids) in buckets {
        let Some(folder_id) = folders.get(&name) else {
            return Err(format!("alphaXiv has no \"{name}\" folder"));
        };
        for chunk in ids.chunks(50) {
            let r = mcp
                .call("save_papers_to_folder", json!({ "paper_ids_or_urls": chunk, "folder_id": folder_id }))
                .await?;
            // ponytail: count from the per-paper statuses when present, else assume the chunk landed.
            let statuses = r["papers"].as_array().or_else(|| r["results"].as_array());
            match statuses {
                Some(list) => {
                    for item in list {
                        let st = item["status"].as_str().unwrap_or("");
                        if st.contains("not") {
                            report.not_found.push(item["paper_id"].as_str().or(item["id"].as_str()).unwrap_or("?").to_string());
                        } else {
                            report.synced += 1;
                        }
                    }
                }
                None => report.synced += chunk.len(),
            }
        }
    }
    Ok(report)
}
