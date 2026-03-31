use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use super::types::SessionInfo;

/// Max lines to read from the start of a JSONL file.
/// Enough to capture session metadata, custom-title, first user message.
const HEAD_LINES: usize = 100;
/// Max bytes to read from the end for summary/late metadata.
const TAIL_BYTES: u64 = 32_768;

/// Read session info from a JSONL file efficiently.
/// Reads the first HEAD_LINES lines and the last TAIL_BYTES bytes,
/// instead of scanning the entire file (which can be 10-50MB).
fn read_session_from_jsonl(file_path: &Path) -> Option<SessionInfo> {
    let metadata = fs::metadata(file_path).ok()?;
    let file_size = metadata.len();

    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut slug: Option<String> = None;
    let mut model: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut summary: Option<String> = None;
    let mut custom_title: Option<String> = None;
    let mut first_user_message: Option<String> = None;
    let mut first_timestamp: f64 = 0.0;
    let mut last_timestamp: f64 = 0.0;
    let mut message_count: u32 = 0;
    let mut tool_call_count: u32 = 0;

    // --- Read HEAD lines ---
    let reader = BufReader::new(fs::File::open(file_path).ok()?);
    let mut lines_read = 0;
    for line in reader.lines() {
        if lines_read >= HEAD_LINES {
            break;
        }
        let line = match line {
            Ok(l) => l,
            Err(_) => { lines_read += 1; continue; }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        lines_read += 1;
        process_jsonl_line(
            trimmed, &mut session_id, &mut cwd, &mut slug, &mut model,
            &mut git_branch, &mut summary, &mut custom_title,
            &mut first_user_message, &mut first_timestamp,
            &mut last_timestamp, &mut message_count, &mut tool_call_count,
        );
    }

    // --- Read TAIL bytes (for summary, late timestamps, etc.) ---
    if file_size > TAIL_BYTES + 1024 {
        // File is large enough that we haven't read it all in the head pass
        if let Ok(mut f) = fs::File::open(file_path) {
            let seek_pos = file_size.saturating_sub(TAIL_BYTES);
            if f.seek(SeekFrom::Start(seek_pos)).is_ok() {
                let mut tail_buf = String::new();
                if f.read_to_string(&mut tail_buf).is_ok() {
                    // Skip the first partial line
                    let start = tail_buf.find('\n').map(|i| i + 1).unwrap_or(0);
                    for line in tail_buf[start..].lines() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        process_jsonl_line(
                            trimmed, &mut session_id, &mut cwd, &mut slug,
                            &mut model, &mut git_branch, &mut summary,
                            &mut custom_title, &mut first_user_message,
                            &mut first_timestamp, &mut last_timestamp,
                            &mut message_count, &mut tool_call_count,
                        );
                    }
                }
            }
        }
    }

    // Fallback session ID from filename
    if session_id.is_empty() {
        let stem = file_path.file_stem()?.to_str()?;
        if is_uuid(stem) {
            session_id = stem.to_string();
        } else {
            return None;
        }
    }

    // Fallback timestamps from file metadata
    if last_timestamp == 0.0 {
        if let Ok(modified) = metadata.modified() {
            last_timestamp = modified
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64()
                * 1000.0;
        }
    }
    if first_timestamp == 0.0 {
        first_timestamp = last_timestamp;
    }
    if message_count == 0 {
        message_count = 1;
    }

    Some(SessionInfo {
        session_id,
        slug,
        first_message: first_timestamp,
        last_message: last_timestamp,
        message_count,
        tool_call_count,
        cwd,
        summary,
        model,
        git_branch,
        custom_title,
        first_user_message,
    })
}

/// Process a single JSONL line, updating all mutable state.
#[allow(clippy::too_many_arguments)]
fn process_jsonl_line(
    trimmed: &str,
    session_id: &mut String,
    cwd: &mut String,
    slug: &mut Option<String>,
    model: &mut Option<String>,
    git_branch: &mut Option<String>,
    summary: &mut Option<String>,
    custom_title: &mut Option<String>,
    first_user_message: &mut Option<String>,
    first_timestamp: &mut f64,
    last_timestamp: &mut f64,
    message_count: &mut u32,
    tool_call_count: &mut u32,
) {
    let data: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return,
    };

    let msg_type = data.get("type").and_then(|t| t.as_str()).unwrap_or("");

    match msg_type {
        "summary" => {
            if let Some(s) = data.get("summary").and_then(|s| s.as_str()) {
                *summary = Some(s.to_string());
            }
        }
        "custom-title" => {
            if let Some(t) = data.get("customTitle").and_then(|t| t.as_str()) {
                *custom_title = Some(t.to_string());
            }
        }
        "user" => {
            *message_count += 1;
            // Capture first user message text for display
            if first_user_message.is_none() {
                if let Some(msg) = data.get("message") {
                    let content = msg.get("content");
                    if let Some(text) = content.and_then(|c| c.as_str()) {
                        // Simple string content
                        let truncated = truncate_str(text, 120);
                        if !truncated.is_empty() {
                            *first_user_message = Some(truncated);
                        }
                    } else if let Some(arr) = content.and_then(|c| c.as_array()) {
                        // Array content — find first text block
                        for item in arr {
                            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                    let truncated = truncate_str(text, 120);
                                    if !truncated.is_empty() {
                                        *first_user_message = Some(truncated);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            // Track timestamp
            track_timestamp(&data, first_timestamp, last_timestamp);
        }
        "assistant" => {
            *message_count += 1;
            // Get model from first assistant message
            if model.is_none() {
                if let Some(m) = data
                    .get("message")
                    .and_then(|msg| msg.get("model"))
                    .and_then(|m| m.as_str())
                {
                    *model = Some(m.to_string());
                }
            }
            // Count tool uses
            if let Some(content) = data
                .get("message")
                .and_then(|msg| msg.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                        *tool_call_count += 1;
                    }
                }
            }
            track_timestamp(&data, first_timestamp, last_timestamp);
        }
        _ => {
            // Pick up metadata from any line type
        }
    }

    // Session ID + cwd (from any line that has them)
    if cwd.is_empty() {
        if let (Some(sid), Some(c)) = (
            data.get("sessionId").and_then(|s| s.as_str()),
            data.get("cwd").and_then(|s| s.as_str()),
        ) {
            *session_id = sid.to_string();
            *cwd = c.to_string();
        }
    }

    // Slug
    if slug.is_none() {
        if let Some(s) = data.get("slug").and_then(|s| s.as_str()) {
            *slug = Some(s.to_string());
        }
    }

    // Git branch
    if git_branch.is_none() {
        if let Some(b) = data.get("gitBranch").and_then(|b| b.as_str()) {
            *git_branch = Some(b.to_string());
        }
    }
}

fn track_timestamp(data: &serde_json::Value, first: &mut f64, last: &mut f64) {
    if let Some(ts_str) = data.get("timestamp").and_then(|t| t.as_str()) {
        if let Ok(dt) = chrono_parse_timestamp(ts_str) {
            if *first == 0.0 || dt < *first {
                *first = dt;
            }
            if dt > *last {
                *last = dt;
            }
        }
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    // Trim whitespace and take first line only
    let line = s.trim().lines().next().unwrap_or("").trim();
    if line.len() <= max {
        line.to_string()
    } else {
        format!("{}...", &line[..max])
    }
}

/// Simple timestamp parser (handles "2025-01-15T10:30:00.000Z" format)
fn chrono_parse_timestamp(s: &str) -> Result<f64, ()> {
    let s = s.trim_end_matches('Z');
    let parts: Vec<&str> = s.split('T').collect();
    if parts.len() != 2 {
        return Err(());
    }

    let date_parts: Vec<&str> = parts[0].split('-').collect();
    let time_parts: Vec<&str> = parts[1].split(':').collect();

    if date_parts.len() != 3 || time_parts.len() < 3 {
        return Err(());
    }

    let year: i64 = date_parts[0].parse().map_err(|_| ())?;
    let month: i64 = date_parts[1].parse().map_err(|_| ())?;
    let day: i64 = date_parts[2].parse().map_err(|_| ())?;
    let hour: i64 = time_parts[0].parse().map_err(|_| ())?;
    let minute: i64 = time_parts[1].parse().map_err(|_| ())?;

    let sec_str = time_parts[2];
    let sec_parts: Vec<&str> = sec_str.split('.').collect();
    let sec: i64 = sec_parts[0].parse().map_err(|_| ())?;
    let millis: i64 = if sec_parts.len() > 1 {
        let frac = sec_parts[1];
        let padded = format!("{:0<3}", &frac[..frac.len().min(3)]);
        padded.parse().unwrap_or(0)
    } else {
        0
    };

    let mut days: i64 = 0;
    for y in 1970..year {
        days += if is_leap_year(y) { 366 } else { 365 };
    }
    let month_days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for m in 1..month {
        days += month_days[m as usize];
        if m == 2 && is_leap_year(year) {
            days += 1;
        }
    }
    days += day - 1;

    let epoch_ms = (days * 86400 + hour * 3600 + minute * 60 + sec) * 1000 + millis;
    Ok(epoch_ms as f64)
}

fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Convert a filesystem path to the Claude project directory name convention.
/// e.g. "/Users/kenneth/Documents/fun-projects" -> "-Users-kenneth-Documents-fun-projects"
fn path_to_project_dir_name(path: &str) -> String {
    path.replace('/', "-")
}

/// Get sessions from JSONL files, optionally filtered by project path.
/// When project_path is provided, only scans that specific project directory
/// instead of iterating all ~4000 JSONL files.
pub fn get_sessions_from_jsonl(project_path: Option<&str>) -> Vec<SessionInfo> {
    let mut sessions = Vec::new();

    let projects_dir = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("projects"),
        None => return sessions,
    };

    if !projects_dir.exists() {
        return sessions;
    }

    // If we have a project path, only scan that specific directory
    let dirs_to_scan: Vec<std::path::PathBuf> = if let Some(pp) = project_path {
        let dir_name = path_to_project_dir_name(pp);
        let dir = projects_dir.join(&dir_name);
        if dir.is_dir() {
            vec![dir]
        } else {
            vec![]
        }
    } else {
        // Scan all project directories
        match fs::read_dir(&projects_dir) {
            Ok(entries) => entries
                .flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .collect(),
            Err(_) => vec![],
        }
    };

    for dir in dirs_to_scan {
        let files = match fs::read_dir(&dir) {
            Ok(f) => f,
            Err(_) => continue,
        };

        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if !file_path.extension().is_some_and(|e| e == "jsonl") {
                continue;
            }

            // Only session files (UUID.jsonl)
            match file_path.file_stem().and_then(|s| s.to_str()) {
                Some(s) if is_uuid(s) => {}
                _ => continue,
            };

            if let Some(info) = read_session_from_jsonl(&file_path) {
                // Double-check path filter (in case directory convention doesn't match exactly)
                if let Some(pp) = project_path {
                    if !info.cwd.is_empty() && info.cwd != pp {
                        continue;
                    }
                }
                if !info.cwd.is_empty() {
                    sessions.push(info);
                }
            }
        }
    }

    sessions
}

/// Get unique project paths from JSONL directory names (fast, no file reading).
pub fn get_project_paths_from_jsonl() -> Vec<String> {
    let projects_dir = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("projects"),
        None => return Vec::new(),
    };

    if !projects_dir.exists() {
        return Vec::new();
    }

    let mut paths = Vec::new();

    let entries = match fs::read_dir(&projects_dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
            // Convert dir name back to path: "-Users-kenneth-foo" -> "/Users/kenneth/foo"
            // The convention is: replace leading '-' with '/', then all '-' with '/'
            // But this is ambiguous for paths with hyphens in directory names.
            // Safer approach: read one JSONL to get the actual cwd, but cache it.
            // For speed, just convert and verify it looks like a path.
            let decoded = dir_name_to_path(dir_name);
            if decoded.starts_with('/') && !decoded.is_empty() {
                paths.push(decoded);
            }
        }
    }

    paths.sort();
    paths
}

/// Best-effort conversion of Claude's project dir name back to a path.
/// "-Users-kenneth-Documents-fun-projects" -> "/Users/kenneth/Documents/fun-projects"
fn dir_name_to_path(name: &str) -> String {
    // Replace the leading dash with /, then all remaining dashes with /
    if name.starts_with('-') {
        name.replacen('-', "/", 1).replace('-', "/")
    } else {
        format!("/{}", name.replace('-', "/"))
    }
}
