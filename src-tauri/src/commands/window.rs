use tauri::{
    AppHandle, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
};

use crate::error::CockpitError;
use crate::state::AppState;
use crate::workspace::store::Geometry;

/// Open a new top-level app window. Each window runs an independent instance of
/// the UI (its own workspaces + terminals), so it can be dragged to another
/// monitor and show a different workspace.
///
/// `label` lets the session-restore flow recreate a window under its original
/// label (so it reloads its saved state); omit it for a brand-new window.
/// `geometry` restores the window's on-screen position/size (physical pixels).
#[tauri::command]
pub fn open_window(
    app: AppHandle,
    label: Option<String>,
    geometry: Option<Geometry>,
) -> Result<(), CockpitError> {
    let label = label.unwrap_or_else(|| format!("window-{}", uuid::Uuid::new_v4().simple()));

    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Claude Cockpit")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .decorations(false)
        .transparent(true)
        .build()
        .map_err(|e| CockpitError::Window(e.to_string()))?;

    // Restore geometry in physical pixels (matches what the frontend saved).
    if let Some(g) = geometry {
        let _ = window.set_size(PhysicalSize::new(g.width, g.height));
        let _ = window.set_position(PhysicalPosition::new(g.x, g.y));
    }

    Ok(())
}

/// Quit the whole application cleanly. Kills every terminal child process first
/// (dropping the PtyHandles fires their killers — Claude ignores the PTY hangup,
/// so an explicit kill is what actually terminates it), then exits the process.
/// This is what the title-bar close button invokes, so "X" reliably closes the
/// program instead of leaving a windowless zombie behind (the macOS default).
#[tauri::command]
pub fn quit_app(app: AppHandle, state: State<'_, AppState>) {
    if let Ok(mut terminals) = state.terminals.lock() {
        terminals.clear();
    }
    app.exit(0);
}
