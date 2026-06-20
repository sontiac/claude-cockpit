use crate::error::CockpitError;
use crate::workspace::store::{self, PersistedTerminal};

#[tauri::command]
pub fn get_workspace() -> Result<Vec<PersistedTerminal>, CockpitError> {
    Ok(store::get_workspace())
}

#[tauri::command]
pub fn save_workspace(terminals: Vec<PersistedTerminal>) -> Result<(), CockpitError> {
    store::save_workspace(&terminals)
}

#[tauri::command]
pub fn set_session_title(session_id: String, title: String) -> Result<(), CockpitError> {
    store::set_session_title(session_id, title)
}
