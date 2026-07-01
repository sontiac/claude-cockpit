use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::error::CockpitError;
use crate::state::AppState;
use crate::workspace::store::Geometry;

/// Direction for cycling window focus. Deserialized from the frontend as
/// `"next"` / `"prev"`.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CycleDirection {
    Next,
    Prev,
}

/// Stable cycle order: the primary window (`"main"`) first, then every other
/// window label sorted lexicographically. Deterministic across calls so
/// repeated keypresses walk a consistent ring.
fn ordered_labels(labels: &[String]) -> Vec<String> {
    let mut rest: Vec<String> = labels.iter().filter(|l| *l != "main").cloned().collect();
    rest.sort();
    let mut out = Vec::with_capacity(labels.len());
    if labels.iter().any(|l| l == "main") {
        out.push("main".to_string());
    }
    out.extend(rest);
    out
}

/// The label of the window to focus when cycling from `current` in `direction`.
/// Returns `None` when there is nothing to switch to (fewer than two windows,
/// or `current` is not among `labels`).
fn next_window_label(
    labels: &[String],
    current: &str,
    direction: CycleDirection,
) -> Option<String> {
    let ring = ordered_labels(labels);
    if ring.len() < 2 {
        return None;
    }
    let idx = ring.iter().position(|l| l == current)?;
    let n = ring.len();
    let target = match direction {
        CycleDirection::Next => (idx + 1) % n,
        CycleDirection::Prev => (idx + n - 1) % n,
    };
    Some(ring[target].clone())
}

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

/// Cycle focus to the next/previous cockpit window. `window` is the calling
/// window, injected by Tauri, so we trust its real label rather than one passed
/// from the frontend. Brings the target to the front even if it is minimized or
/// hidden behind other windows.
#[tauri::command]
pub fn cycle_window(
    window: WebviewWindow,
    app: AppHandle,
    direction: CycleDirection,
) -> Result<(), CockpitError> {
    let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    let current = window.label().to_string();

    let Some(target) = next_window_label(&labels, &current, direction) else {
        return Ok(()); // Nothing to switch to.
    };

    if let Some(target_window) = app.get_webview_window(&target) {
        let _ = target_window.unminimize();
        let _ = target_window.show();
        target_window
            .set_focus()
            .map_err(|e| CockpitError::Window(e.to_string()))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn orders_main_first_then_lexicographic() {
        let ls = labels(&["window-c", "main", "window-a"]);
        assert_eq!(ordered_labels(&ls), labels(&["main", "window-a", "window-c"]));
    }

    #[test]
    fn next_moves_forward() {
        let ls = labels(&["main", "window-a", "window-b"]);
        assert_eq!(
            next_window_label(&ls, "main", CycleDirection::Next).as_deref(),
            Some("window-a")
        );
    }

    #[test]
    fn next_wraps_last_to_first() {
        let ls = labels(&["main", "window-a", "window-b"]);
        assert_eq!(
            next_window_label(&ls, "window-b", CycleDirection::Next).as_deref(),
            Some("main")
        );
    }

    #[test]
    fn prev_wraps_first_to_last() {
        let ls = labels(&["main", "window-a", "window-b"]);
        assert_eq!(
            next_window_label(&ls, "main", CycleDirection::Prev).as_deref(),
            Some("window-b")
        );
    }

    #[test]
    fn single_window_returns_none() {
        let ls = labels(&["main"]);
        assert_eq!(next_window_label(&ls, "main", CycleDirection::Next), None);
    }

    #[test]
    fn unknown_current_returns_none() {
        let ls = labels(&["main", "window-a"]);
        assert_eq!(next_window_label(&ls, "ghost", CycleDirection::Next), None);
    }
}
