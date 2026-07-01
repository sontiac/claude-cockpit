# Window Cycling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `Option+Tab` / `Option+Shift+Tab` keybind that cycles focus between the app's open cockpit windows.

**Architecture:** A frontend keydown handler in the focused window calls a new Tauri command `cycle_window`. The command enumerates open windows, computes the next/previous window via a pure, unit-tested ring helper (`main` first, then secondaries lexicographically, wraparound), and brings the target to the front with `unminimize → show → set_focus`.

**Tech Stack:** Rust (Tauri v2), TypeScript/React.

## Global Constraints

- Windows stay frameless (`decorations: false` + `transparent: true`) — do NOT change window style. This feature must not alter the window chrome.
- No new dependencies.
- The command trusts the Tauri-injected calling window's label, never a label passed from the frontend.
- Cycle order is a stable ring: label `"main"` first, then remaining labels sorted lexicographically, with wraparound.
- Errors on `unminimize`/`show` are ignored (no-ops when not minimized/hidden); `set_focus` is the essential step.

---

### Task 1: Backend `cycle_window` command + ring helper

**Files:**
- Modify: `src-tauri/src/commands/window.rs` (add helper, enum, command, tests)
- Modify: `src-tauri/src/lib.rs:70-71` (register command in `invoke_handler`)

**Interfaces:**
- Consumes: nothing from other tasks. Uses Tauri `AppHandle`, `WebviewWindow`, `Manager` trait (`webview_windows()`, `get_webview_window()`), and existing `crate::error::CockpitError` (variant `Window(String)` already exists).
- Produces: Tauri command `cycle_window` invokable from the frontend as `invoke("cycle_window", { direction })` where `direction` is `"next"` or `"prev"`. Task 2 relies on this exact command name and payload shape.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/commands/window.rs`:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib cycle_window 2>&1 | tail -20; cargo test --lib window::tests 2>&1 | tail -20`
Expected: FAIL — compile error, `ordered_labels` / `next_window_label` / `CycleDirection` not found.

- [ ] **Step 3: Add the direction enum and pure helpers**

Add near the top of `src-tauri/src/commands/window.rs`, after the `use` block:

```rust
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib window::tests 2>&1 | tail -20`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Add the `cycle_window` command**

Update the `use` block at the top of `src-tauri/src/commands/window.rs` to add `Manager` and `WebviewWindow`:

```rust
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
```

Add the command (e.g. after `open_window`):

```rust
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
```

- [ ] **Step 6: Register the command in `lib.rs`**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler!` list (around line 70-71), add `commands::window::cycle_window` after `commands::window::open_window,`:

```rust
            commands::window::open_window,
            commands::window::cycle_window,
            commands::window::quit_app,
```

- [ ] **Step 7: Verify the crate builds and tests still pass**

Run: `cd src-tauri && cargo test --lib window::tests 2>&1 | tail -20 && cargo build 2>&1 | tail -20`
Expected: 6 tests PASS; build succeeds (warnings OK, no errors).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/window.rs src-tauri/src/lib.rs
git commit -m "feat(windows): cycle_window command + ring helper"
```

---

### Task 2: IPC wrapper + Option+Tab keybind

**Files:**
- Modify: `src/lib/ipc.ts` (add `cycleWindow` wrapper)
- Modify: `src/App.tsx:116-152` (add the `altKey + Tab` branch to the keydown handler); `src/App.tsx` import line for ipc.

**Interfaces:**
- Consumes: the `cycle_window` command from Task 1 (`invoke("cycle_window", { direction })`, `direction: "next" | "prev"`).
- Produces: nothing consumed by later tasks (this is the final task).

- [ ] **Step 1: Add the IPC wrapper**

In `src/lib/ipc.ts`, next to the existing `openWindow` export, add:

```ts
export const cycleWindow = (direction: "next" | "prev") =>
  invoke<void>("cycle_window", { direction });
```

- [ ] **Step 2: Import `cycleWindow` in `App.tsx`**

In `src/App.tsx` line 16, add `cycleWindow` to the existing ipc import. Change:

```ts
import { setSessionTitle, openWindow } from "./lib/ipc";
```

to:

```ts
import { setSessionTitle, openWindow, cycleWindow } from "./lib/ipc";
```

- [ ] **Step 3: Add the Option+Tab branch to the keydown handler**

In `src/App.tsx`, inside `handleKeyDown` (starts at line 116), add this branch **before** the existing `if (e.metaKey || e.ctrlKey) {` block — Option+Tab uses `altKey`, not meta/ctrl. Use `e.code === "Tab"` (physical key) because macOS's Option modifier can remap `e.key` for some keys:

```ts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Option+Tab cycles cockpit windows (Option+Shift+Tab reverses).
      // preventDefault stops the focused terminal from receiving a Tab.
      if (e.altKey && e.code === "Tab") {
        e.preventDefault();
        cycleWindow(e.shiftKey ? "prev" : "next").catch(console.error);
        return;
      }

      if (e.metaKey || e.ctrlKey) {
```

Do NOT add anything to the effect's dependency array: `cycleWindow` is a stable module-level import and the branch closes over no component state.

- [ ] **Step 4: Verify the frontend builds**

Run: `npm run build 2>&1 | tail -20`
Expected: `tsc` clean, vite build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/App.tsx
git commit -m "feat(windows): Option+Tab keybind to cycle windows"
```

- [ ] **Step 6: Manual verification (by the user — do NOT run the app)**

The implementer must NOT build/run the app (the user runs it live). Hand off these checks for the user to perform:
1. Open 2-3 cockpit windows (New Window button), drag them apart / behind other apps.
2. With one focused, press `Option+Tab` — focus moves to the next window (it comes to the front).
3. Repeat — it cycles through all windows and wraps around.
4. `Option+Shift+Tab` cycles in reverse.
5. With a terminal focused and actively selected, `Option+Tab` still switches windows and does NOT insert a Tab / escape sequence into the terminal.
6. Minimize a window, then cycle to it — it un-minimizes and comes forward.

If check 5 fails (xterm swallows the key first), the fallback per the spec is to attach the handler in the capture phase (`window.addEventListener("keydown", handleKeyDown, true)`) — but only apply that if a live test shows it is needed.

---

## Notes for the implementer

- Tauri v2: `webview_windows()` and `get_webview_window()` come from the `tauri::Manager` trait — the `use` update in Task 1 Step 5 brings it in.
- `WebviewWindow` as a command parameter is injected by Tauri with the calling window; it is not sent from JS.
- `#[serde(rename_all = "lowercase")]` maps the enum so `"next"` → `Next`, `"prev"` → `Prev`.
