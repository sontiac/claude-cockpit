use std::collections::HashMap;

use crate::error::CockpitError;
use crate::session::{db, jsonl, types::SessionInfo};

#[tauri::command]
pub fn get_sessions(
    limit: Option<u32>,
    project_path: Option<String>,
) -> Result<Vec<SessionInfo>, CockpitError> {
    let limit = limit.unwrap_or(50);
    let pp = project_path.as_deref();

    // Get from both sources
    let jsonl_sessions = jsonl::get_sessions_from_jsonl(pp);
    let db_sessions = db::get_sessions_from_db(limit * 2, pp);

    // Merge (prefer JSONL)
    let mut session_map: HashMap<String, SessionInfo> = HashMap::new();

    for session in db_sessions {
        session_map.insert(session.session_id.clone(), session);
    }

    for session in jsonl_sessions {
        let key = session.session_id.clone();
        if let Some(existing) = session_map.get(&key) {
            let merged = SessionInfo {
                session_id: session.session_id,
                slug: session.slug.or(existing.slug.clone()),
                first_message: session.first_message,
                last_message: session.last_message,
                message_count: session.message_count.max(existing.message_count),
                tool_call_count: session.tool_call_count.max(existing.tool_call_count),
                cwd: session.cwd,
                summary: session.summary.or(existing.summary.clone()),
                model: session.model.or(existing.model.clone()),
                git_branch: session.git_branch.or(existing.git_branch.clone()),
            };
            session_map.insert(key, merged);
        } else {
            session_map.insert(key, session);
        }
    }

    let mut result: Vec<SessionInfo> = session_map.into_values().collect();
    result.sort_by(|a, b| b.last_message.partial_cmp(&a.last_message).unwrap());
    result.truncate(limit as usize);

    Ok(result)
}

#[tauri::command]
pub fn get_project_paths() -> Result<Vec<String>, CockpitError> {
    let mut paths = std::collections::HashSet::new();

    for p in jsonl::get_project_paths_from_jsonl() {
        paths.insert(p);
    }
    for p in db::get_project_paths_from_db() {
        paths.insert(p);
    }

    let mut result: Vec<String> = paths.into_iter().collect();
    result.sort();
    Ok(result)
}
