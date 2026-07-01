use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// A persisted note pane: enough to recreate the window on next launch. The text
/// content lives separately (content file keyed by id), never here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedNote {
    pub id: String,
    pub label: String,
    pub color: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
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

pub fn get_window_notes(label: &str) -> Vec<PersistedNote> {
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
    notes: &[PersistedNote],
) -> Result<(), crate::error::CockpitError> {
    let path = window_file(label)
        .ok_or_else(|| crate::error::CockpitError::InvalidInput("Bad window label".into()))?;
    fs::write(&path, serde_json::to_string_pretty(notes)?)?;
    Ok(())
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

    fn note(id: &str) -> PersistedNote {
        PersistedNote {
            id: id.into(),
            label: "Note".into(),
            color: "#fff".into(),
            workspace_id: Some("ws-1".into()),
        }
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
