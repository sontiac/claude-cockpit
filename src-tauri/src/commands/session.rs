use std::collections::HashMap;

use crate::error::CockpitError;
use crate::session::{db, jsonl, types::SessionContext, types::SessionInfo};

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
                custom_title: session.custom_title.or(existing.custom_title.clone()),
                first_user_message: session.first_user_message.or(existing.first_user_message.clone()),
                starred: false,
            };
            session_map.insert(key, merged);
        } else {
            session_map.insert(key, session);
        }
    }

    let result: Vec<SessionInfo> = session_map.into_values().collect();
    let stars = crate::workspace::store::get_session_stars();
    let mut result = pin_starred_and_limit(result, &stars, limit as usize);

    // Overlay cockpit's own session-title overrides (a /rename done inside
    // cockpit). These take precedence over any on-disk title.
    let overrides = crate::workspace::store::get_session_titles();
    for s in result.iter_mut() {
        if let Some(title) = overrides.get(&s.session_id) {
            s.custom_title = Some(title.clone());
        }
    }

    Ok(result)
}

/// Overlay stars, sort by recency, pin starred sessions first, and apply the
/// limit to the unstarred remainder only — starred sessions never age out.
fn pin_starred_and_limit(
    mut sessions: Vec<SessionInfo>,
    stars: &std::collections::HashSet<String>,
    limit: usize,
) -> Vec<SessionInfo> {
    for s in sessions.iter_mut() {
        s.starred = stars.contains(&s.session_id);
    }
    sessions.sort_by(|a, b| {
        b.last_message
            .partial_cmp(&a.last_message)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let (mut starred, unstarred): (Vec<_>, Vec<_>) =
        sessions.into_iter().partition(|s| s.starred);
    starred.extend(unstarred.into_iter().take(limit));
    starred
}

/// Current context-window usage for a live session, read from its transcript.
/// Returns `None` when the session hasn't written a turn yet (so the caller can
/// simply show nothing until data exists).
#[tauri::command]
pub fn get_session_context(
    session_id: String,
    cwd: String,
) -> Result<Option<SessionContext>, CockpitError> {
    Ok(jsonl::get_session_context(&session_id, &cwd))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::types::SessionInfo;
    use std::collections::HashSet;

    fn session(id: &str, last_message: f64) -> SessionInfo {
        SessionInfo {
            session_id: id.to_string(),
            slug: None,
            first_message: 0.0,
            last_message,
            message_count: 1,
            tool_call_count: 0,
            cwd: "/tmp".to_string(),
            summary: None,
            model: None,
            git_branch: None,
            custom_title: None,
            first_user_message: None,
            starred: false,
        }
    }

    #[test]
    fn starred_sessions_pin_first_and_escape_the_limit() {
        let sessions = vec![
            session("new1", 400.0),
            session("new2", 300.0),
            session("old-starred", 100.0),
            session("old", 200.0),
        ];
        let stars: HashSet<String> = ["old-starred".to_string()].into();
        let result = pin_starred_and_limit(sessions, &stars, 2);
        let ids: Vec<&str> = result.iter().map(|s| s.session_id.as_str()).collect();
        // Starred first, then the 2 most recent unstarred; "old" dropped by limit.
        assert_eq!(ids, vec!["old-starred", "new1", "new2"]);
        assert!(result[0].starred);
        assert!(!result[1].starred);
    }

    #[test]
    fn unstarred_lists_sort_by_recency_and_truncate() {
        let sessions = vec![session("a", 100.0), session("b", 300.0), session("c", 200.0)];
        let result = pin_starred_and_limit(sessions, &HashSet::new(), 2);
        let ids: Vec<&str> = result.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c"]);
    }

    #[test]
    fn multiple_starred_sort_by_recency_within_the_pinned_group() {
        let sessions = vec![session("s1", 100.0), session("s2", 300.0), session("u", 200.0)];
        let stars: HashSet<String> = ["s1".to_string(), "s2".to_string()].into();
        let result = pin_starred_and_limit(sessions, &stars, 5);
        let ids: Vec<&str> = result.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s2", "s1", "u"]);
    }
}
