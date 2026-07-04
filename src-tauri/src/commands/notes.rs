use crate::error::CockpitError;
use crate::notes::store::{self, PersistedNote};

#[tauri::command]
pub fn get_window_notes(label: String) -> Result<Vec<PersistedNote>, CockpitError> {
    Ok(store::get_window_notes(&label))
}

#[tauri::command]
pub fn save_window_notes(label: String, notes: Vec<PersistedNote>) -> Result<(), CockpitError> {
    store::save_window_notes(&label, &notes)
}

#[tauri::command]
pub fn get_note_content(id: String) -> Result<Option<serde_json::Value>, CockpitError> {
    Ok(store::get_note_content(&id))
}

#[tauri::command]
pub fn save_note_content(id: String, content: serde_json::Value) -> Result<(), CockpitError> {
    store::save_note_content(&id, &content)
}

#[tauri::command]
pub fn remove_note_content(id: String) -> Result<(), CockpitError> {
    store::remove_note_content(&id);
    Ok(())
}

#[tauri::command]
pub fn remove_window_notes(label: String) -> Result<(), CockpitError> {
    store::remove_window_notes(&label);
    Ok(())
}

#[tauri::command]
pub fn clear_notes() -> Result<(), CockpitError> {
    store::clear_notes()
}
