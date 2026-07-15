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

/// Forget one window's saved session so a deliberately-closed window is not
/// offered for recovery on next launch.
#[tauri::command]
pub fn remove_window_state(label: String) -> Result<(), CockpitError> {
    store::remove_window_state(&label);
    Ok(())
}

#[tauri::command]
pub fn set_session_title(session_id: String, title: String) -> Result<(), CockpitError> {
    store::set_session_title(session_id, title)
}

/// Star/unstar a session. Starred sessions pin to the top of the sidebar list
/// and never age out of it.
#[tauri::command]
pub fn set_session_starred(session_id: String, starred: bool) -> Result<(), CockpitError> {
    store::set_session_starred(session_id, starred)
}
