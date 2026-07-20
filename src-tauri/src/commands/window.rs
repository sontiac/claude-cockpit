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
        // Tauri's native drag-drop handler swallows DOM dragover/drop on macOS
        // (wry overrides NSDraggingDestination without forwarding to WKWebView),
        // which kills HTML5 drag-and-drop — the sidebar and workspace-bar
        // reordering need it. Nothing accepts OS file drops, so disable it.
        // Keep in sync with dragDropEnabled=false in tauri.conf.json.
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| CockpitError::Window(e.to_string()))?;

    // Restore geometry in physical pixels (matches what the frontend saved).
    if let Some(g) = geometry {
        let _ = window.set_size(PhysicalSize::new(g.width, g.height));
        let _ = window.set_position(PhysicalPosition::new(g.x, g.y));
    }

    Ok(())
}

/// Tolerance (physical px) when comparing a window frame to a monitor work
/// area — scale-factor rounding can leave the applied frame a pixel or two off.
const MAXIMIZE_TOLERANCE: i32 = 2;

/// Whether `frame` fills `work_area` — i.e. the window is maximized *on that
/// monitor*. Compares position as well as size: a window maximized on one
/// monitor and dragged to a same-resolution monitor matches in size only, and
/// must not read as maximized there.
fn is_maximized_frame(frame: &Geometry, work_area: &Geometry) -> bool {
    let close = |a: i32, b: i32| (a - b).abs() <= MAXIMIZE_TOLERANCE;
    close(frame.x, work_area.x)
        && close(frame.y, work_area.y)
        && close(frame.width as i32, work_area.width as i32)
        && close(frame.height as i32, work_area.height as i32)
}

/// Fallback restore frame when un-maximizing a window with no saved
/// pre-maximize frame (e.g. it was session-restored already at work-area
/// size): the default window size, centered in `work_area`, clamped to fit.
fn centered_default(work_area: &Geometry) -> Geometry {
    let width = work_area.width.min(1280);
    let height = work_area.height.min(800);
    Geometry {
        x: work_area.x + ((work_area.width - width) / 2) as i32,
        y: work_area.y + ((work_area.height - height) / 2) as i32,
        width,
        height,
    }
}

/// Toggle maximize for the calling window, returning the new maximized state.
///
/// Cockpit implements this itself instead of using tao's `set_maximized`
/// because tao's fallback path for undecorated (borderless) windows is broken
/// on macOS: it maximizes onto `NSScreen::mainScreen` rather than the window's
/// own screen, and un-maximize restores the frame saved on whatever monitor
/// the window was last maximized on — both of which fling the window back to
/// its original monitor (tao 0.35.3 still has this).
///
/// Here maximize fills the *current* monitor's work area, saving the previous
/// frame per window label; toggling again restores that frame.
#[tauri::command]
pub fn toggle_maximize(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<bool, CockpitError> {
    let err = |e: tauri::Error| CockpitError::Window(e.to_string());

    let pos = window.outer_position().map_err(err)?;
    let size = window.outer_size().map_err(err)?;
    let frame = Geometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };

    let monitor = window
        .current_monitor()
        .map_err(err)?
        .ok_or_else(|| CockpitError::Window("window is not on any monitor".into()))?;
    let area = monitor.work_area();
    let work_area = Geometry {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    };

    let mut saved_frames = state
        .maximize_frames
        .lock()
        .map_err(|e| CockpitError::Window(e.to_string()))?;

    if is_maximized_frame(&frame, &work_area) {
        let target = saved_frames
            .remove(window.label())
            .unwrap_or_else(|| centered_default(&work_area));
        window
            .set_size(PhysicalSize::new(target.width, target.height))
            .map_err(err)?;
        window
            .set_position(PhysicalPosition::new(target.x, target.y))
            .map_err(err)?;
        Ok(false)
    } else {
        saved_frames.insert(window.label().to_string(), frame);
        window
            .set_size(PhysicalSize::new(work_area.width, work_area.height))
            .map_err(err)?;
        window
            .set_position(PhysicalPosition::new(work_area.x, work_area.y))
            .map_err(err)?;
        Ok(true)
    }
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

    fn geo(x: i32, y: i32, width: u32, height: u32) -> Geometry {
        Geometry {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn frame_filling_work_area_is_maximized() {
        let work = geo(0, 25, 2560, 1415);
        assert!(is_maximized_frame(&geo(0, 25, 2560, 1415), &work));
    }

    #[test]
    fn frame_within_tolerance_is_maximized() {
        // Scale-factor rounding can leave the frame a pixel or two off the
        // work area; still counts as maximized.
        let work = geo(0, 25, 2560, 1415);
        assert!(is_maximized_frame(&geo(1, 26, 2559, 1414), &work));
    }

    #[test]
    fn smaller_frame_is_not_maximized() {
        let work = geo(0, 25, 2560, 1415);
        assert!(!is_maximized_frame(&geo(100, 100, 1280, 800), &work));
    }

    #[test]
    fn same_size_frame_on_other_monitor_is_not_maximized() {
        // A window maximized on monitor A then dragged to a same-resolution
        // monitor B matches B's work area in size but not position — it must
        // NOT read as maximized there, or toggling would restore the stale
        // frame back on monitor A (the tao bug this replaces).
        let work_b = geo(2560, 25, 2560, 1415);
        assert!(!is_maximized_frame(&geo(0, 25, 2560, 1415), &work_b));
    }

    #[test]
    fn centered_default_sits_inside_work_area() {
        let work = geo(2560, 25, 2560, 1415);
        let d = centered_default(&work);
        assert_eq!(d.width, 1280);
        assert_eq!(d.height, 800);
        assert_eq!(d.x, 2560 + (2560 - 1280) as i32 / 2);
        assert_eq!(d.y, 25 + (1415 - 800) as i32 / 2);
    }

    #[test]
    fn centered_default_clamps_to_small_work_area() {
        // Work area smaller than the default window: fill it instead of
        // overflowing off-screen.
        let work = geo(0, 25, 1024, 640);
        let d = centered_default(&work);
        assert_eq!((d.x, d.y), (0, 25));
        assert_eq!((d.width, d.height), (1024, 640));
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
