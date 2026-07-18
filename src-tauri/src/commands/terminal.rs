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
    provider: Option<String>,
) -> Result<TerminalInfo, CockpitError> {
    // Resolve the provider profile into concrete env before spawning. Unknown
    // ids and unresolvable secrets fail the spawn outright — a terminal that
    // silently fell back to Anthropic would bill the wrong provider.
    let extra_env = match provider.as_deref() {
        None => Vec::new(),
        Some(id) => {
            let profiles = crate::providers::load();
            let profile = profiles
                .iter()
                .find(|p| p.id == id)
                .ok_or_else(|| CockpitError::InvalidInput(format!("unknown provider: {id}")))?;
            crate::providers::resolve_env(&profile.env, crate::providers::secret_lookup)?
        }
    };

    let handle = PtyHandle::spawn(
        app,
        id.clone(),
        cwd,
        command,
        label,
        color,
        project_id,
        provider,
        extra_env,
    )?;
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
