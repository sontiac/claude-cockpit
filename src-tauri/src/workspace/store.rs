use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    /// Provider profile id the terminal ran on (None = default Claude). Only
    /// the id is persisted — resolved env can contain secrets and never
    /// touches disk here.
    #[serde(default)]
    pub provider: Option<String>,
}

/// A named workspace — a tab grouping a set of terminals within one window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
}

/// An x/y/width/height rectangle. The unit depends on the use site: persisted
/// window frames ([`WindowState::frame`]) are in *logical points* — the OS's
/// global coordinate space, unambiguous across mixed-DPI monitors — while the
/// maximize bookkeeping in `commands::window` measures and applies *physical
/// pixels* within a single monitor.
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
    /// The window's on-screen frame in logical points, so it can reopen on the
    /// same monitor/spot. Named `frame` (not `geometry`) deliberately: older
    /// builds persisted physical pixels under `geometry`, which restore to the
    /// wrong rectangle on mixed-DPI monitor setups — renaming the key discards
    /// those stale values instead of misapplying them.
    #[serde(default)]
    pub frame: Option<Geometry>,
    /// Whether the sidebar is pinned (docked). Unpinned sidebars hide and
    /// reveal on left-edge hover. Defaults to false (hidden).
    #[serde(default)]
    pub sidebar_pinned: bool,
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

// --- Session stars ---------------------------------------------------------
// Starred sessions pin to the top of the sidebar and are exempt from the
// recency cap, so an important chat can be found (and its terminal safely
// closed) long after it stops being recent. Stored as a sorted JSON array of
// session ids, sibling to session_titles.json.

fn session_stars_file() -> PathBuf {
    base_dir().join("session_stars.json")
}

pub fn get_session_stars() -> HashSet<String> {
    let path = session_stars_file();
    if !path.exists() {
        return HashSet::new();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => HashSet::new(),
    }
}

pub fn set_session_starred(
    session_id: String,
    starred: bool,
) -> Result<(), crate::error::CockpitError> {
    let mut stars = get_session_stars();
    if starred {
        stars.insert(session_id);
    } else {
        stars.remove(&session_id);
    }
    let mut sorted: Vec<&String> = stars.iter().collect();
    sorted.sort();
    fs::write(session_stars_file(), serde_json::to_string_pretty(&sorted)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Old on-disk snapshots predate the field; they must load as unpinned
    /// (hidden), the spec'd default.
    #[test]
    fn window_state_without_sidebar_pinned_defaults_to_false() {
        let json = r#"{"workspaces":[],"terminals":[],"active_workspace_id":null,"geometry":null}"#;
        let state: WindowState = serde_json::from_str(json).unwrap();
        assert!(!state.sidebar_pinned);
    }

    #[test]
    fn window_state_round_trips_sidebar_pinned() {
        let state = WindowState {
            sidebar_pinned: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&state).unwrap();
        let back: WindowState = serde_json::from_str(&json).unwrap();
        assert!(back.sidebar_pinned);
    }

    /// Snapshots from builds that stored the frame in physical pixels used the
    /// `geometry` key. Physical pixels are ambiguous across mixed-DPI monitors
    /// (the same numbers mean different rectangles depending on which screen
    /// does the conversion), so those values must be discarded, not reused.
    #[test]
    fn window_state_ignores_legacy_physical_geometry() {
        let json = r#"{"workspaces":[],"terminals":[],"active_workspace_id":null,"geometry":{"x":0,"y":66,"width":3456,"height":2168}}"#;
        let state: WindowState = serde_json::from_str(json).unwrap();
        assert!(state.frame.is_none());
    }

    #[test]
    fn window_state_round_trips_logical_frame() {
        let state = WindowState {
            frame: Some(Geometry {
                x: -2560,
                y: -193,
                width: 1728,
                height: 1084,
            }),
            ..Default::default()
        };
        let json = serde_json::to_string(&state).unwrap();
        let back: WindowState = serde_json::from_str(&json).unwrap();
        let frame = back.frame.unwrap();
        assert_eq!((frame.x, frame.y), (-2560, -193));
        assert_eq!((frame.width, frame.height), (1728, 1084));
    }
}
