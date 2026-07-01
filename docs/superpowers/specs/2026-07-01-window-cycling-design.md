# Design: Cycle Between Cockpit Windows

**Date:** 2026-07-01
**Status:** Approved, ready for implementation plan

## Problem

Claude Cockpit can spawn multiple top-level OS windows (via the "New Window"
button → the `open_window` Tauri command). Each window is an independent UI
instance, often dragged to a different monitor.

With multiple monitors this is easy to manage, but on a single screen (e.g. a
laptop) there is no fast way to move between cockpit windows. `Cmd+Tab` switches
between *apps*, but nothing switches between the *windows of this app*. macOS's
native "cycle app windows" shortcut (`Cmd+\``) does not help either: it only
operates on **titled** windows, and cockpit windows are deliberately frameless
(`decorations: false` + `transparent: true`), so macOS excludes them from
`Cmd+\``, the Dock's window list, and Mission Control.

Making the windows titled would restore all of that natively, but it changes the
custom frameless look, which we want to keep. So instead we add our own in-app
keybind that cycles focus between cockpit windows.

## Non-goals (YAGNI)

- No on-screen window picker / overlay — a keybind cycle is enough.
- No Dock / Mission Control integration (that is the titled-window path, which
  was considered and declined to preserve the frameless look).
- No spatial / position-based cycle order — a stable ring is enough.

## Approach

A keybind, handled inside the focused cockpit window, asks the backend to focus
the next (or previous) cockpit window. This works whenever any cockpit window is
focused, which matches the real workflow: the user `Cmd+Tab`s into cockpit, then
uses the keybind to move between its windows. It preserves the frameless look
entirely and uses only standard Tauri window APIs (no hacks).

### Keybind

- `Option+Tab` → focus **next** cockpit window.
- `Option+Shift+Tab` → focus **previous** cockpit window.

This mirrors the mental model `Cmd+Tab` (apps) → `Option+Tab` (windows within the
app).

## Components

### 1. Backend — `cycle_window` command (`src-tauri/src/commands/window.rs`)

```rust
pub fn cycle_window(
    window: WebviewWindow,     // the calling window, injected by Tauri
    app: AppHandle,
    direction: CycleDirection, // "next" | "prev"
) -> Result<(), CockpitError>
```

- Tauri injects the **calling** window, so we use its real label rather than one
  passed (and potentially spoofed/stale) from the frontend.
- Enumerate open windows via `app.webview_windows()`.
- Compute the target label with a pure helper (see below).
- On the target window: `unminimize()` → `show()` → `set_focus()`, so it comes to
  the front even if minimized or buried behind other apps' windows. Ignore
  errors on `unminimize`/`show` (a window that is neither minimized nor hidden
  makes those no-ops).
- Register in `lib.rs`'s `invoke_handler`.

`CycleDirection` is a small serde enum deserialized from `"next"` / `"prev"`.

#### Pure ring helper (unit-testable)

Factor the ordering + wraparound out of the command so it needs no live window:

```rust
fn next_window_label(labels: &[String], current: &str, direction: CycleDirection) -> Option<String>
```

- **Ordering:** build a stable ring — `main` first, then the remaining labels
  sorted lexicographically. Deterministic across calls, so repeated presses walk
  a consistent ring.
- **Step:** find `current`'s index, move `+1` (next) or `-1` (prev) with
  wraparound (modular arithmetic).
- **Single window / current not found:** return `None` (caller no-ops).

### 2. IPC wrapper (`src/lib/ipc.ts`)

```ts
export const cycleWindow = (direction: "next" | "prev") =>
  invoke<void>("cycle_window", { direction });
```

### 3. Frontend keybind (`src/App.tsx`)

Extend the existing document-level keyboard handler (the one already handling
`Cmd+T`, `Cmd+1-9`, `Cmd+Shift+N`, etc.):

- `altKey && key === "Tab" && !shiftKey` → `cycleWindow("next")`.
- `altKey && key === "Tab" && shiftKey` → `cycleWindow("prev")`.
- Call `preventDefault()` so the focused terminal (xterm) never receives a stray
  Tab / escape sequence. This is the same interception pattern the existing
  shortcuts already rely on.

## Data flow

```
Option+Tab (focused window)
  → App.tsx keydown handler (preventDefault)
  → ipc.cycleWindow("next")
  → cycle_window command (calling window injected)
  → next_window_label(all labels, caller label, Next)
  → target.unminimize() / show() / set_focus()
  → macOS brings the target cockpit window to front + focus
```

## Error handling

- Unknown / single window: `next_window_label` returns `None`; command returns
  `Ok(())` (silent no-op — correct UX, nothing to switch to).
- Focus/show/unminimize failures: logged/ignored per call; a failure on one step
  should not abort the others. `set_focus` is the essential step.

## Testing

- **Rust unit tests** for `next_window_label`:
  - stable ordering (`main` first, then lexicographic).
  - `next` wraparound (last → first).
  - `prev` wraparound (first → last).
  - single-window → `None`.
  - `current` not in list → `None`.
- **Manual (live, by the user):** the focus side effect and the `Option+Tab`
  keybind wiring — including that it is interceptable over a focused xterm
  terminal. This is the one behavior that cannot be verified without a live run.

## Open risk

Whether `Option+Tab` is cleanly interceptable at the document level while a
terminal (xterm) is focused is unverified without a live run. It uses the same
handler and `preventDefault` path as the existing working shortcuts, so it is
expected to hold; if xterm swallows it first, the fallback is to bind the handler
in the capture phase or on a higher-level element.
