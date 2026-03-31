use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use super::types::SessionInfo;

/// Read session info from a single JSONL file
fn read_session_from_jsonl(file_path: &Path) -> Option<SessionInfo> {
    let file = fs::File::open(file_path).ok()?;
    let reader = BufReader::new(file);
    let metadata = fs::metadata(file_path).ok()?;

    let mut summary: Option<String> = None;
    let mut slug: Option<String> = None;
    let mut model: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut cwd = String::new();
    let mut session_id = String::new();
    let mut first_timestamp: f64 = 0.0;
    let mut last_timestamp: f64 = 0.0;
    let mut message_count: u32 = 0;
    let mut tool_call_count: u32 = 0;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let data: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Get summary
        if data.get("type").and_then(|t| t.as_str()) == Some("summary") {
            if let Some(s) = data.get("summary").and_then(|s| s.as_str()) {
                summary = Some(s.to_string());
            }
        }

        // Get slug (human-readable session name like "glowing-jingling-gizmo")
        if slug.is_none() {
            if let Some(s) = data.get("slug").and_then(|s| s.as_str()) {
                slug = Some(s.to_string());
            }
        }

        // Get git branch
        if git_branch.is_none() {
            if let Some(b) = data.get("gitBranch").and_then(|b| b.as_str()) {
                git_branch = Some(b.to_string());
            }
        }

        // Get session info from first message with sessionId + cwd
        if cwd.is_empty() {
            if let (Some(sid), Some(c)) = (
                data.get("sessionId").and_then(|s| s.as_str()),
                data.get("cwd").and_then(|s| s.as_str()),
            ) {
                session_id = sid.to_string();
                cwd = c.to_string();
            }
        }

        // Track timestamps
        if let Some(ts_str) = data.get("timestamp").and_then(|t| t.as_str()) {
            if let Ok(dt) = chrono_parse_timestamp(ts_str) {
                if first_timestamp == 0.0 || dt < first_timestamp {
                    first_timestamp = dt;
                }
                if dt > last_timestamp {
                    last_timestamp = dt;
                }
            }
        }

        // Count messages and extract model
        match data.get("type").and_then(|t| t.as_str()) {
            Some("user") | Some("assistant") => {
                message_count += 1;
                // Get model from assistant messages
                if model.is_none() {
                    if let Some(m) = data
                        .get("message")
                        .and_then(|msg| msg.get("model"))
                        .and_then(|m| m.as_str())
                    {
                        model = Some(m.to_string());
                    }
                }
                // Count tool uses in assistant content
                if let Some(content) = data
                    .get("message")
                    .and_then(|msg| msg.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for item in content {
                        if item.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            tool_call_count += 1;
                        }
                    }
                }
            }
            _ => {}
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
    })
}

/// Simple timestamp parser (handles "2025-01-15T10:30:00.000Z" format)
fn chrono_parse_timestamp(s: &str) -> Result<f64, ()> {
    // Try to parse ISO 8601: "2025-01-15T10:30:00.000Z"
    // Simple approach: split and parse
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

    // Handle seconds with fractional part
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

    // Simple epoch calculation (not perfectly accurate for all dates but good enough)
    // Days from epoch to year
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
    s.len() == 36
        && s.chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Get sessions from all JSONL files in ~/.claude/projects/
pub fn get_sessions_from_jsonl(project_path: Option<&str>) -> Vec<SessionInfo> {
    let mut sessions = Vec::new();

    let projects_dir = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("projects"),
        None => return sessions,
    };

    if !projects_dir.exists() {
        return sessions;
    }

    let project_dirs = match fs::read_dir(&projects_dir) {
        Ok(dirs) => dirs,
        Err(_) => return sessions,
    };

    for entry in project_dirs.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let files = match fs::read_dir(&path) {
            Ok(f) => f,
            Err(_) => continue,
        };

        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if !file_path.extension().is_some_and(|e| e == "jsonl") {
                continue;
            }

            // Only session files (UUID.jsonl)
            let _stem = match file_path.file_stem().and_then(|s| s.to_str()) {
                Some(s) if is_uuid(s) => s.to_string(),
                _ => continue,
            };

            if let Some(info) = read_session_from_jsonl(&file_path) {
                // Filter by project path if specified
                if let Some(pp) = project_path {
                    if info.cwd != pp {
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

/// Get unique project paths from JSONL files
pub fn get_project_paths_from_jsonl() -> Vec<String> {
    let mut paths = std::collections::HashSet::new();

    let projects_dir = match dirs::home_dir() {
        Some(home) => home.join(".claude").join("projects"),
        None => return Vec::new(),
    };

    if !projects_dir.exists() {
        return Vec::new();
    }

    let project_dirs = match fs::read_dir(&projects_dir) {
        Ok(dirs) => dirs,
        Err(_) => return Vec::new(),
    };

    for entry in project_dirs.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Read one JSONL file to get actual cwd
        let files = match fs::read_dir(&path) {
            Ok(f) => f,
            Err(_) => continue,
        };

        for file_entry in files.flatten() {
            let file_path = file_entry.path();
            if !file_path.extension().is_some_and(|e| e == "jsonl") {
                continue;
            }
            match file_path.file_stem().and_then(|s| s.to_str()) {
                Some(s) if is_uuid(s) => {},
                _ => continue,
            };

            if let Some(info) = read_session_from_jsonl(&file_path) {
                if !info.cwd.is_empty() {
                    paths.insert(info.cwd);
                    break; // Only need one per project dir
                }
            }
        }
    }

    let mut result: Vec<String> = paths.into_iter().collect();
    result.sort();
    result
}
