use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    pub prompt: String,
    pub context: String,
    pub provider: String,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum AiEvent {
    Chunk { text: String },
    Error { message: String },
    Done,
}

const MAX_CONTEXT_CHARS: usize = 48_000;

fn build_prompt(context: &str, question: &str) -> String {
    let ctx: String = context.chars().take(MAX_CONTEXT_CHARS).collect();
    format!(
        "You are a research assistant helping someone read an academic paper. \
Answer the question using the paper content below. Be concise and accurate, and \
cite section names or short quotes when helpful. If the answer is not in the \
provided text, say so briefly rather than guessing.\n\n\
=== PAPER CONTENT (may be truncated) ===\n{ctx}\n\n\
=== QUESTION ===\n{question}\n"
    )
}

fn build_queries_prompt(context: &str) -> String {
    format!(
        "A researcher has been reading papers with the topics, keywords, and titles below. \
Suggest 4 arXiv search queries that would surface RELATED but NEW work they likely have not \
read yet — adjacent methods, recent follow-ups, competing approaches, or foundational \
references. Respond with ONLY a JSON array of 4 short query strings (each 2-6 words, suitable \
for arXiv full-text search), no commentary.\n\n\
READER PROFILE:\n{context}\n"
    )
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Common install locations for CLIs that may not be on a GUI app's PATH.
fn extra_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join(".cargo/bin"));
        // nvm-managed node versions (codex et al. resolve node from here)
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            for entry in entries.flatten() {
                dirs.push(entry.path().join("bin"));
            }
        }
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/usr/bin"));
    dirs
}

fn resolve_binary(name: &str) -> Option<PathBuf> {
    let mut search: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        search.extend(std::env::split_paths(&path));
    }
    search.extend(extra_path_dirs());
    search.into_iter().map(|d| d.join(name)).find(|c| c.is_file())
}

/// PATH for the child so the CLI can find node/git/etc. even when launched from Finder.
fn child_path_env() -> String {
    let mut parts: Vec<String> = extra_path_dirs()
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if let Some(path) = std::env::var_os("PATH") {
        parts.push(path.to_string_lossy().into_owned());
    }
    parts.join(":")
}

/// Strip NUL and other control characters that can't be passed as a process
/// argument (PDF-extracted text often contains stray control bytes).
fn sanitize_arg(s: String) -> String {
    s.chars()
        .filter(|&c| c == '\n' || c == '\r' || c == '\t' || !c.is_control())
        .collect()
}

/// Map a provider id + prompt to a binary name and argv.
fn build_invocation(provider: &str, prompt: String, model: Option<&str>) -> (&'static str, Vec<String>) {
    let prompt = sanitize_arg(prompt);
    let (bin, mut args): (&'static str, Vec<String>) = match provider {
        "codex" => ("codex", vec!["exec".into(), prompt]),
        _ => ("claude", vec!["-p".into(), prompt]),
    };
    if let Some(m) = model.filter(|m| !m.is_empty()) {
        args.push("--model".into());
        args.push(m.to_string());
    }
    (bin, args)
}

fn resolved_bin(bin_name: &str) -> String {
    resolve_binary(bin_name)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| bin_name.to_string())
}

/// Run a CLI to completion and return its full stdout (non-streaming).
async fn run_collect(provider: &str, prompt: String, model: Option<&str>) -> Result<String, String> {
    let (bin_name, args) = build_invocation(provider, prompt, model);
    let output = Command::new(resolved_bin(bin_name))
        .args(&args)
        .env("PATH", child_path_env())
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| format!("failed to launch `{bin_name}`: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(if err.trim().is_empty() {
            format!("{bin_name} exited with {}", output.status)
        } else {
            err.trim().to_string()
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run an arbitrary prompt (built by the frontend, e.g. the editable indexing /
/// references templates) and return the CLI's full stdout.
#[tauri::command]
pub async fn run_prompt(prompt: String, provider: String, model: Option<String>) -> Result<String, String> {
    run_collect(&provider, prompt, model.as_deref()).await
}

#[tauri::command]
pub async fn suggest_queries(
    context: String,
    provider: String,
    model: Option<String>,
) -> Result<String, String> {
    run_collect(&provider, build_queries_prompt(&context), model.as_deref()).await
}


/// Extract the incremental text from one `claude --output-format stream-json` line.
/// Only stream_event text deltas carry new text; system/assistant/result lines are
/// ignored so the same content isn't sent twice.
fn parse_stream_line(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "stream_event" {
        return None;
    }
    let event = v.get("event")?;
    if event.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    let delta = event.get("delta")?;
    if delta.get("type")?.as_str()? != "text_delta" {
        return None;
    }
    Some(delta.get("text")?.as_str()?.to_string())
}

#[tauri::command]
pub async fn ask_ai(request: AskRequest, on_event: Channel<AiEvent>) -> Result<(), String> {
    let full = build_prompt(&request.context, &request.prompt);
    let (bin_name, mut args) = build_invocation(&request.provider, full, request.model.as_deref());

    // Token-level streaming: with plain `-p`, claude buffers the whole response and
    // prints it at the end. stream-json emits deltas as they're generated.
    let is_claude = bin_name == "claude";
    if is_claude {
        for flag in ["--output-format", "stream-json", "--verbose", "--include-partial-messages"] {
            args.push(flag.into());
        }
    }

    let mut child = Command::new(resolved_bin(bin_name))
        .args(&args)
        .env("PATH", child_path_env())
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("failed to launch `{bin_name}`: {e}. Make sure the CLI is installed and on your PATH.")
        })?;

    let stdout = child.stdout.take().ok_or("no stdout handle")?;
    let mut stderr = child.stderr.take().ok_or("no stderr handle")?;

    // Stream stdout to the frontend: claude emits stream-json lines we reduce to
    // text deltas; codex output is forwarded line-by-line as-is.
    let stdout_channel = on_event.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let text = if is_claude {
                match parse_stream_line(&line) {
                    Some(t) => t,
                    None => continue,
                }
            } else {
                format!("{line}\n")
            };
            let _ = stdout_channel.send(AiEvent::Chunk { text });
        }
    });

    // Drain stderr concurrently to avoid pipe deadlock.
    let mut err_buf = String::new();
    let _ = stderr.read_to_string(&mut err_buf).await;

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = stdout_task.await;

    if !status.success() {
        let message = if err_buf.trim().is_empty() {
            format!("{bin_name} exited with {status}")
        } else {
            err_buf.trim().to_string()
        };
        let _ = on_event.send(AiEvent::Error { message });
    }

    let _ = on_event.send(AiEvent::Done);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_stream_line;

    #[test]
    fn stream_line_parsing() {
        let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}}"#;
        assert_eq!(parse_stream_line(delta), Some("Hello".to_string()));

        // Non-delta events must be ignored (their text would double-send).
        let assistant = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#;
        assert_eq!(parse_stream_line(assistant), None);
        let system = r#"{"type":"system","subtype":"init"}"#;
        assert_eq!(parse_stream_line(system), None);
        let result = r#"{"type":"result","result":"Hello"}"#;
        assert_eq!(parse_stream_line(result), None);
        let other_delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}}"#;
        assert_eq!(parse_stream_line(other_delta), None);
        assert_eq!(parse_stream_line("not json"), None);
    }
}
