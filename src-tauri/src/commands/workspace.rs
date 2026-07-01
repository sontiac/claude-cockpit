use crate::error::CockpitError;
use crate::workspace::store::{self, WindowState};

#[tauri::command]
pub fn get_window_state(label: String) -> Result<WindowState, CockpitError> {
    Ok(store::get_window_state(&label))
}

#[tauri::command]
pub fn save_window_state(label: String, state: WindowState) -> Result<(), CockpitError> {
    store::save_window_state(&label, &state)
}

#[tauri::command]
pub fn list_session_labels() -> Result<Vec<String>, CockpitError> {
    Ok(store::list_session_labels())
}

#[tauri::command]
pub fn clear_session() -> Result<(), CockpitError> {
    store::clear_session()
}

#[tauri::command]
pub fn set_session_title(session_id: String, title: String) -> Result<(), CockpitError> {
    store::set_session_title(session_id, title)
}
