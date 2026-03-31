use rusqlite::Connection;
use std::path::PathBuf;

use super::types::SessionInfo;

fn db_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("__store.db"))
}

/// Get sessions from SQLite database
pub fn get_sessions_from_db(limit: u32, project_path: Option<&str>) -> Vec<SessionInfo> {
    let path = match db_path() {
        Some(p) if p.exists() => p,
        _ => return Vec::new(),
    };

    let conn = match Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let (query, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(pp) =
        project_path
    {
        (
            format!(
                "SELECT bm.session_id, MIN(bm.timestamp) as first_message, \
                 MAX(bm.timestamp) as last_message, COUNT(*) as message_count, \
                 MAX(bm.cwd) as cwd, cs.summary \
                 FROM base_messages bm \
                 LEFT JOIN conversation_summaries cs ON cs.leaf_uuid = ( \
                   SELECT uuid FROM base_messages sub \
                   WHERE sub.session_id = bm.session_id \
                   ORDER BY sub.timestamp DESC LIMIT 1 \
                 ) \
                 WHERE bm.cwd = ?1 \
                 GROUP BY bm.session_id \
                 ORDER BY last_message DESC \
                 LIMIT ?2"
            ),
            vec![
                Box::new(pp.to_string()) as Box<dyn rusqlite::types::ToSql>,
                Box::new(limit),
            ],
        )
    } else {
        (
            format!(
                "SELECT bm.session_id, MIN(bm.timestamp) as first_message, \
                 MAX(bm.timestamp) as last_message, COUNT(*) as message_count, \
                 MAX(bm.cwd) as cwd, cs.summary \
                 FROM base_messages bm \
                 LEFT JOIN conversation_summaries cs ON cs.leaf_uuid = ( \
                   SELECT uuid FROM base_messages sub \
                   WHERE sub.session_id = bm.session_id \
                   ORDER BY sub.timestamp DESC LIMIT 1 \
                 ) \
                 GROUP BY bm.session_id \
                 ORDER BY last_message DESC \
                 LIMIT ?1"
            ),
            vec![Box::new(limit) as Box<dyn rusqlite::types::ToSql>],
        )
    };

    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = match stmt.query_map(param_refs.as_slice(), |row| {
        Ok(SessionInfo {
            session_id: row.get(0)?,
            slug: None,
            first_message: row.get(1)?,
            last_message: row.get(2)?,
            message_count: row.get(3)?,
            tool_call_count: 0,
            cwd: row.get::<_, String>(4).unwrap_or_default(),
            summary: row.get(5).ok(),
            model: None,
            git_branch: None,
            custom_title: None,
            first_user_message: None,
        })
    }) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    rows.flatten().collect()
}

/// Get unique project paths from SQLite
pub fn get_project_paths_from_db() -> Vec<String> {
    let path = match db_path() {
        Some(p) if p.exists() => p,
        _ => return Vec::new(),
    };

    let conn = match Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT DISTINCT cwd FROM base_messages WHERE cwd IS NOT NULL AND cwd != '' ORDER BY cwd",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    rows.flatten().collect()
}
