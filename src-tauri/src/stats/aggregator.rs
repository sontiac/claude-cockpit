use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Per-file running totals. Transcript JSONL files are append-only, so we record
/// how many bytes we've already folded into these counts (`bytes_consumed`) and,
/// on each scan, parse only the bytes appended since. A trailing partial line (a
/// write in progress) is left unconsumed until it ends in a newline, so it gets
/// counted exactly once on the next scan.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct FileStat {
    bytes_consumed: u64,
    output_tokens: u64,
    input_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
    user_messages: u64,
    assistant_messages: u64,
    tool_calls: u64,
    /// Claude project directory name this file lived under, for distinct-project
    /// counting. Refreshed on every scan so it survives cache reloads.
    project: String,
}

impl FileStat {
    fn has_activity(&self) -> bool {
        self.user_messages > 0 || self.assistant_messages > 0
    }
}

/// Lifetime stats across every Claude session — the raw material the frontend
/// turns into level / class / XP. Counts only grow: cache entries for sessions
/// that Claude later prunes from disk are retained, so earned XP never drops.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub output_tokens: u64,
    pub input_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    /// Genuine user prompts (text records, not tool-result `user` lines).
    pub user_messages: u64,
    pub assistant_messages: u64,
    pub tool_calls: u64,
    pub sessions: u64,
    pub projects: u64,
}

type Cache = HashMap<String, FileStat>;

fn cache_file() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit");
    fs::create_dir_all(&dir).ok();
    dir.join("stats_cache.json")
}

fn load_cache() -> Cache {
    match fs::read_to_string(cache_file()) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => Cache::new(),
    }
}

fn save_cache(cache: &Cache) {
    if let Ok(data) = serde_json::to_string(cache) {
        let _ = fs::write(cache_file(), data);
    }
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Compute lifetime player stats, updating the byte-offset cache in place. The
/// first call folds every transcript in full (potentially seconds of IO); later
/// calls only read the bytes appended since, so this is cheap enough to poll.
pub fn get_player_stats() -> PlayerStats {
    let projects_dir = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("projects"),
        None => return PlayerStats::default(),
    };

    let mut cache = load_cache();

    if let Ok(dir_entries) = fs::read_dir(&projects_dir) {
        for dir_entry in dir_entries.flatten() {
            let dir_path = dir_entry.path();
            if !dir_path.is_dir() {
                continue;
            }
            let project_name = dir_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let files = match fs::read_dir(&dir_path) {
                Ok(f) => f,
                Err(_) => continue,
            };
            for file_entry in files.flatten() {
                let file_path = file_entry.path();
                if !file_path.extension().is_some_and(|e| e == "jsonl") {
                    continue;
                }
                match file_path.file_stem().and_then(|s| s.to_str()) {
                    Some(s) if is_uuid(s) => {}
                    _ => continue,
                }
                let size = match fs::metadata(&file_path) {
                    Ok(m) => m.len(),
                    Err(_) => continue,
                };

                let key = file_path.to_string_lossy().to_string();
                let entry = cache.entry(key).or_default();
                entry.project = project_name.clone();
                // File shrank → truncated or replaced; re-fold from the start so
                // counts match the current contents rather than double-counting.
                if size < entry.bytes_consumed {
                    let project = entry.project.clone();
                    *entry = FileStat {
                        project,
                        ..Default::default()
                    };
                }
                if size > entry.bytes_consumed {
                    scan_new_bytes(&file_path, entry);
                }
            }
        }
    }

    let mut stats = PlayerStats::default();
    let mut active_projects: HashSet<&str> = HashSet::new();
    for entry in cache.values() {
        stats.output_tokens += entry.output_tokens;
        stats.input_tokens += entry.input_tokens;
        stats.cache_read_tokens += entry.cache_read_tokens;
        stats.cache_creation_tokens += entry.cache_creation_tokens;
        stats.user_messages += entry.user_messages;
        stats.assistant_messages += entry.assistant_messages;
        stats.tool_calls += entry.tool_calls;
        if entry.has_activity() {
            stats.sessions += 1;
            if !entry.project.is_empty() {
                active_projects.insert(entry.project.as_str());
            }
        }
    }
    stats.projects = active_projects.len() as u64;

    save_cache(&cache);
    stats
}

/// Read the bytes appended since `entry.bytes_consumed`, folding each complete
/// new line into the entry. Stops at a trailing partial line so an in-progress
/// write is counted whole on the next scan.
fn scan_new_bytes(file_path: &Path, entry: &mut FileStat) {
    let mut file = match fs::File::open(file_path) {
        Ok(f) => f,
        Err(_) => return,
    };
    if file.seek(SeekFrom::Start(entry.bytes_consumed)).is_err() {
        return;
    }
    let mut reader = BufReader::new(file);
    let mut consumed = entry.bytes_consumed;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = match reader.read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        // Incomplete final line (no trailing newline): leave it for next time.
        if line.last() != Some(&b'\n') {
            break;
        }
        consumed += n as u64;
        if let Ok(text) = std::str::from_utf8(&line) {
            process_stat_line(text.trim(), entry);
        }
    }
    entry.bytes_consumed = consumed;
}

fn process_stat_line(trimmed: &str, entry: &mut FileStat) {
    if trimmed.is_empty() {
        return;
    }
    let data: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return,
    };
    match data.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        // Tool results are also logged as `user` records; count only genuine
        // text prompts so "messages sent" means what the user typed.
        "user" => {
            if user_has_text(&data) {
                entry.user_messages += 1;
            }
        }
        "assistant" => {
            entry.assistant_messages += 1;
            if let Some(message) = data.get("message") {
                if let Some(usage) = message.get("usage") {
                    entry.input_tokens += usage_u64(usage, "input_tokens");
                    entry.output_tokens += usage_u64(usage, "output_tokens");
                    entry.cache_read_tokens += usage_u64(usage, "cache_read_input_tokens");
                    entry.cache_creation_tokens +=
                        usage_u64(usage, "cache_creation_input_tokens");
                }
                if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                    for item in content {
                        if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            entry.tool_calls += 1;
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// True when a `user` record carries actual prompt text (string content or a
/// non-empty text block), as opposed to a pure tool-result continuation.
fn user_has_text(data: &serde_json::Value) -> bool {
    let content = match data.get("message").and_then(|m| m.get("content")) {
        Some(c) => c,
        None => return false,
    };
    if let Some(s) = content.as_str() {
        return !s.trim().is_empty();
    }
    if let Some(arr) = content.as_array() {
        return arr.iter().any(|item| {
            item.get("type").and_then(|t| t.as_str()) == Some("text")
                && item
                    .get("text")
                    .and_then(|t| t.as_str())
                    .is_some_and(|s| !s.trim().is_empty())
        });
    }
    false
}

fn usage_u64(usage: &serde_json::Value, key: &str) -> u64 {
    usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
}
