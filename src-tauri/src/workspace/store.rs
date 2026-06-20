use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// A snapshot of one open terminal, enough to recreate it on next launch.
/// Deliberately excludes the runtime id and transient status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedTerminal {
    pub cwd: String,
    pub label: String,
    pub color: String,
    pub command: String,
    pub project_id: Option<String>,
}

fn workspace_file() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit");
    fs::create_dir_all(&dir).ok();
    dir.join("workspace.json")
}

pub fn get_workspace() -> Vec<PersistedTerminal> {
    let path = workspace_file();
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_workspace(terminals: &[PersistedTerminal]) -> Result<(), crate::error::CockpitError> {
    let path = workspace_file();
    let data = serde_json::to_string_pretty(terminals)?;
    fs::write(&path, data)?;
    Ok(())
}

// --- Session title overrides ---------------------------------------------
// Claude does not persist a /rename to disk when it runs inside cockpit's PTY,
// so cockpit records the names the user assigns here (session id -> title) and
// overlays them on the session list. This keeps renames sticky and visible in
// the sidebar without writing into Claude's own .jsonl files.

fn session_titles_file() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit");
    fs::create_dir_all(&dir).ok();
    dir.join("session_titles.json")
}

pub fn get_session_titles() -> HashMap<String, String> {
    let path = session_titles_file();
    if !path.exists() {
        return HashMap::new();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

pub fn set_session_title(
    session_id: String,
    title: String,
) -> Result<(), crate::error::CockpitError> {
    let mut titles = get_session_titles();
    titles.insert(session_id, title);
    let path = session_titles_file();
    fs::write(&path, serde_json::to_string_pretty(&titles)?)?;
    Ok(())
}
