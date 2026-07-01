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
    /// Which workspace this terminal belongs to. Optional for back-compat with
    /// the pre-workspaces format (those terminals land in the default workspace).
    #[serde(default)]
    pub workspace_id: Option<String>,
}

/// A named workspace — a tab grouping a set of terminals within one window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
}

/// A window's on-screen rectangle in physical pixels, so it can reopen on the
/// same monitor/spot. Physical throughout (JS reads physical, Rust applies
/// physical) to avoid scale-factor conversions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The full persisted state for one window: its workspaces, the terminals open
/// in each, which workspace was active, and where the window sat on screen.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WindowState {
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub terminals: Vec<PersistedTerminal>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub geometry: Option<Geometry>,
}

fn base_dir() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit");
    fs::create_dir_all(&dir).ok();
    dir
}

fn session_dir() -> PathBuf {
    let dir = base_dir().join("session");
    fs::create_dir_all(&dir).ok();
    dir
}

/// Filenames are derived from window labels, which cockpit controls ("main" or
/// "window-<uuid>"). Reject anything else so a label can never escape the dir.
fn is_safe_label(label: &str) -> bool {
    !label.is_empty()
        && label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn window_file(label: &str) -> Option<PathBuf> {
    if !is_safe_label(label) {
        return None;
    }
    Some(session_dir().join(format!("{label}.json")))
}

/// Legacy single-window persistence file (pre multi-window). Used to migrate the
/// main window's saved terminals the first time the session store is read.
fn legacy_workspace_file() -> PathBuf {
    base_dir().join("workspace.json")
}

fn read_window_file(path: &PathBuf) -> Option<WindowState> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str::<WindowState>(&data).ok()
}

pub fn get_window_state(label: &str) -> WindowState {
    if let Some(path) = window_file(label) {
        if path.exists() {
            if let Some(state) = read_window_file(&path) {
                return state;
            }
        }
    }

    // Migration: the main window inherits any legacy workspace.json (which held
    // either a WindowState-shaped object or, older still, a bare terminal array).
    if label == "main" {
        let legacy = legacy_workspace_file();
        if legacy.exists() {
            if let Ok(data) = fs::read_to_string(&legacy) {
                if let Ok(state) = serde_json::from_str::<WindowState>(&data) {
                    return state;
                }
                if let Ok(terminals) =
                    serde_json::from_str::<Vec<PersistedTerminal>>(&data)
                {
                    return WindowState {
                        terminals,
                        ..Default::default()
                    };
                }
            }
        }
    }

    WindowState::default()
}

pub fn save_window_state(
    label: &str,
    state: &WindowState,
) -> Result<(), crate::error::CockpitError> {
    let path = window_file(label)
        .ok_or_else(|| crate::error::CockpitError::InvalidInput("Bad window label".into()))?;
    fs::write(&path, serde_json::to_string_pretty(state)?)?;
    Ok(())
}

pub fn remove_window_state(label: &str) {
    if let Some(path) = window_file(label) {
        fs::remove_file(path).ok();
    }
}

/// Labels of all windows with saved state (for recreating the session).
pub fn list_session_labels() -> Vec<String> {
    let dir = session_dir();
    let mut labels = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    labels.push(stem.to_string());
                }
            }
        }
    }
    labels
}

/// Discard the entire saved session (all windows). Also removes the legacy file
/// so a discarded session can't resurrect from it.
pub fn clear_session() -> Result<(), crate::error::CockpitError> {
    for label in list_session_labels() {
        remove_window_state(&label);
    }
    fs::remove_file(legacy_workspace_file()).ok();
    Ok(())
}

// --- Session title overrides ---------------------------------------------
// Claude does not persist a /rename to disk when it runs inside cockpit's PTY,
// so cockpit records the names the user assigns here (session id -> title) and
// overlays them on the session list. This keeps renames sticky and visible in
// the sidebar without writing into Claude's own .jsonl files.

fn session_titles_file() -> PathBuf {
    base_dir().join("session_titles.json")
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
