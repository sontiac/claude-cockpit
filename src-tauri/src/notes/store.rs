use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_kind() -> String {
    "note".into()
}

/// A persisted canvas pane: enough to recreate the window on next launch.
/// Note text content lives separately (content file keyed by id), never here.
/// `kind` selects the pane type; per-kind config rides along as optional
/// fields the store never interprets. Files written before panes had kinds
/// deserialize as notes via the `kind` default.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedPane {
    pub id: String,
    pub label: String,
    pub color: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
    /// mdviewer: absolute path of the markdown file being viewed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// pomodoro: focus duration in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_minutes: Option<u32>,
    /// pomodoro: break duration in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub break_minutes: Option<u32>,
}

fn base_dir() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit")
        .join("notes");
    fs::create_dir_all(&dir).ok();
    dir
}

fn windows_dir() -> PathBuf {
    let dir = base_dir().join("windows");
    fs::create_dir_all(&dir).ok();
    dir
}

fn content_dir() -> PathBuf {
    let dir = base_dir().join("content");
    fs::create_dir_all(&dir).ok();
    dir
}

/// Filenames are derived from window labels and note ids, both cockpit-controlled.
/// Reject anything with path-escaping characters so a value can never leave the dir.
fn is_safe(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn window_file(label: &str) -> Option<PathBuf> {
    if !is_safe(label) {
        return None;
    }
    Some(windows_dir().join(format!("{label}.json")))
}

fn content_file(id: &str) -> Option<PathBuf> {
    if !is_safe(id) {
        return None;
    }
    Some(content_dir().join(format!("{id}.json")))
}

pub fn get_window_notes(label: &str) -> Vec<PersistedPane> {
    let Some(path) = window_file(label) else {
        return Vec::new();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_window_notes(
    label: &str,
    notes: &[PersistedPane],
) -> Result<(), crate::error::CockpitError> {
    let path = window_file(label)
        .ok_or_else(|| crate::error::CockpitError::InvalidInput("Bad window label".into()))?;
    fs::write(&path, serde_json::to_string_pretty(notes)?)?;
    Ok(())
}

/// Remove one window's note-pane list (its content files are deleted separately,
/// keyed by note id). Used when a window is deliberately closed and forgotten.
pub fn remove_window_notes(label: &str) {
    if let Some(path) = window_file(label) {
        fs::remove_file(path).ok();
    }
}

pub fn get_note_content(id: &str) -> Option<serde_json::Value> {
    let path = content_file(id)?;
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn save_note_content(
    id: &str,
    content: &serde_json::Value,
) -> Result<(), crate::error::CockpitError> {
    let path = content_file(id)
        .ok_or_else(|| crate::error::CockpitError::InvalidInput("Bad note id".into()))?;
    fs::write(&path, serde_json::to_string_pretty(content)?)?;
    Ok(())
}

pub fn remove_note_content(id: &str) {
    if let Some(path) = content_file(id) {
        fs::remove_file(path).ok();
    }
}

/// Discard every note file (pane lists + content). Called on session discard.
pub fn clear_notes() -> Result<(), crate::error::CockpitError> {
    for dir in [windows_dir(), content_dir()] {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                fs::remove_file(entry.path()).ok();
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str) -> PersistedPane {
        PersistedPane {
            id: id.into(),
            label: "Note".into(),
            color: "#fff".into(),
            workspace_id: Some("ws-1".into()),
            kind: "note".into(),
            path: None,
            work_minutes: None,
            break_minutes: None,
        }
    }

    #[test]
    fn legacy_note_json_defaults_to_note_kind() {
        let json = r##"[{"id":"n-1","label":"Todo","color":"#abc","workspace_id":"ws-9"}]"##;
        let panes: Vec<PersistedPane> = serde_json::from_str(json).unwrap();
        assert_eq!(panes[0].kind, "note");
        assert_eq!(panes[0].path, None);
        assert_eq!(panes[0].work_minutes, None);
    }

    #[test]
    fn pane_kinds_round_trip() {
        let label = "test-window-kinds";
        let panes = vec![
            note("n-1"),
            PersistedPane {
                id: "v-1".into(),
                label: "Plan".into(),
                color: "#0af".into(),
                workspace_id: Some("ws-1".into()),
                kind: "mdviewer".into(),
                path: Some("/tmp/plan.md".into()),
                work_minutes: None,
                break_minutes: None,
            },
            PersistedPane {
                id: "p-1".into(),
                label: "Pomodoro".into(),
                color: "#f80".into(),
                workspace_id: Some("ws-1".into()),
                kind: "pomodoro".into(),
                path: None,
                work_minutes: Some(25),
                break_minutes: Some(5),
            },
        ];
        save_window_notes(label, &panes).unwrap();
        assert_eq!(get_window_notes(label), panes);
        fs::remove_file(window_file(label).unwrap()).ok();
    }

    #[test]
    fn rejects_unsafe_names() {
        assert!(!is_safe("../etc"));
        assert!(!is_safe("a/b"));
        assert!(!is_safe(""));
        assert!(is_safe("main"));
        assert!(is_safe("window-abc_123"));
        assert!(window_file("../escape").is_none());
        assert!(content_file("../escape").is_none());
    }

    #[test]
    fn window_notes_round_trip() {
        let label = "test-window-roundtrip";
        let notes = vec![note("n-1"), note("n-2")];
        save_window_notes(label, &notes).unwrap();
        assert_eq!(get_window_notes(label), notes);
        // cleanup
        fs::remove_file(window_file(label).unwrap()).ok();
    }

    #[test]
    fn content_write_read_remove() {
        let id = "test-note-content";
        let content = serde_json::json!({ "type": "doc", "content": [] });
        save_note_content(id, &content).unwrap();
        assert_eq!(get_note_content(id), Some(content));
        remove_note_content(id);
        assert_eq!(get_note_content(id), None);
    }

    #[test]
    fn missing_files_are_empty() {
        assert_eq!(get_window_notes("test-nonexistent-window"), Vec::new());
        assert_eq!(get_note_content("test-nonexistent-note"), None);
    }
}
