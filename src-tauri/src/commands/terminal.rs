use tauri::{AppHandle, State};

use crate::error::CockpitError;
use crate::pty::manager::{PtyHandle, TerminalInfo};
use crate::state::AppState;

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: String,
    command: Option<String>,
    label: String,
    color: String,
    project_id: Option<String>,
) -> Result<TerminalInfo, CockpitError> {
    let handle = PtyHandle::spawn(app, id.clone(), cwd, command, label, color, project_id)?;
    let info = handle.info.clone();
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|e| CockpitError::Pty(e.to_string()))?;
    terminals.insert(id, handle);
    Ok(info)
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), CockpitError> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| CockpitError::Pty(e.to_string()))?;
    let handle = terminals
        .get(&id)
        .ok_or_else(|| CockpitError::NotFound(id))?;
    handle.write(data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), CockpitError> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| CockpitError::Pty(e.to_string()))?;
    let handle = terminals
        .get(&id)
        .ok_or_else(|| CockpitError::NotFound(id))?;
    handle.resize(cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, id: String) -> Result<(), CockpitError> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|e| CockpitError::Pty(e.to_string()))?;
    terminals.remove(&id);
    Ok(())
}

#[tauri::command]
pub fn get_terminals(state: State<'_, AppState>) -> Result<Vec<TerminalInfo>, CockpitError> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| CockpitError::Pty(e.to_string()))?;
    Ok(terminals.values().map(|h| h.info.clone()).collect())
}
