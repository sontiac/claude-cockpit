# Drag-and-Drop Fix — Design

**Date:** 2026-08-03
**Status:** Approved

## Problem

Dropping a file from Finder navigates the webview to that file, with no way back.
Tauri's drag-drop handler is disabled (`"dragDropEnabled": false` in
`tauri.conf.json`, `.disable_drag_drop_handler()` in `open_window`), because
wry's macOS handler swallows HTML5 drag events and the sidebar/tab reordering
used HTML5 dnd. With the handler off, OS file drops fall through to WKWebView's
default behavior: navigation.

## Approaches considered

- **A (chosen): re-enable Tauri drag-drop; migrate the two HTML5 dnd
  interactions to pointer events.** Tauri's handler consumes OS drops (no
  navigation) and delivers real file paths via `onDragDropEvent`.
- **B: keep it disabled; window-level `dragover`/`drop` preventDefault.** Stops
  navigation but WKWebView's HTML5 `File` objects carry no filesystem paths, so
  paste-into-PTY is impossible. Rejected.
- **C: enable the native handler for file drags only.** Not possible — wry's
  handler is all-or-nothing per webview. Rejected.

## Design

### 1. Config flip

Remove `"dragDropEnabled": false` from `tauri.conf.json` and
`.disable_drag_drop_handler()` from `open_window` in
`src-tauri/src/commands/window.rs`. Update the comment explaining why it was
disabled (the reorder UIs no longer use HTML5 dnd).

### 2. Pointer-reorder for workspace tabs — `src/hooks/useListReorder.ts`

> **Amended 2026-08-03:** sidebar project reordering moved to context-menu
> "Move up"/"Move down" items (user request — the per-row drag handle wasted
> row width), so the sidebar no longer uses drag-and-drop at all. Only the
> TopBar tab reorder still needs migrating off HTML5 dnd.

A hook replaces the hand-rolled HTML5 implementation for workspace-tab
reorder in `TopBar.tsx`, following the window-listener gesture pattern
`TerminalCanvas.startGesture` already uses:

- `pointerdown` on the drag surface arms the gesture; a ~4px movement
  threshold distinguishes drag from click (tabs keep click-to-switch and
  dblclick-to-rename).
- Items register their DOM elements (`registerItem(index, el)`); `pointermove`
  computes `overIndex` from bounding-rect midpoints.
- `pointerup` past the threshold commits the reorder; the click event that
  follows a real drag is swallowed.
- Window-level `pointermove`/`pointerup` listeners; `document.body.userSelect`
  suppressed during the drag.
- Exposes `dragIndex`/`overIndex` so both components keep their existing
  opacity/ring styling.

TopBar keeps whole-tab drag with the `editingId !== ws.id` guard.

### 3. File drops — `src/hooks/useFileDrop.ts` + `src/lib/shellQuote.ts`

A hook mounted once per window subscribes to
`getCurrentWebview().onDragDropEvent` (`@tauri-apps/api/webview`; events are
per-webview, so multi-window works for free):

- **Targeting:** convert the event's `PhysicalPosition` to CSS pixels
  (÷ `window.devicePixelRatio`), then
  `document.elementFromPoint().closest('[data-pane-id][data-pane-kind="terminal"]')`.
  The pane wrapper in `TerminalCanvas.tsx` gains those two data attributes.
  This keeps the hook decoupled from layout state and naturally handles only
  visible panes.
- **Drag-over feedback:** the terminal pane under the cursor gets the existing
  cyan-ring treatment (same styling as reorder targets); cleared on
  leave/drop.
- **Drop on a terminal pane:** each dropped path shell-escaped, all paths
  joined with single spaces, one trailing space, written to that pane's PTY
  via `ptyWrite(paneId, text)`; the pane becomes active.
- **Drop anywhere else:** no-op. (Viewer panes for images/md/pdf on
  empty-canvas drop are a later follow-up, out of scope here.)

`shellQuote.ts` is a pure function: paths containing only safe characters
(`[A-Za-z0-9/_.-]` etc.) pass through; anything else is wrapped in single
quotes with embedded single quotes escaped as `'\''`.

### 4. Testing

- `shellQuote` unit tests: spaces, single/double quotes, unicode, clean paths.
- `useListReorder` via pointer-event sequences; existing drag coverage in
  `TopBar.test.tsx` ported from dragstart/drop to pointer events (threshold,
  reorder commit, click suppression, no-drag-while-renaming). Sidebar reorder
  is covered by its context-menu tests instead.
- `useFileDrop` with mocked `onDragDropEvent` + stubbed `elementFromPoint`:
  escaped `ptyWrite` payloads, multi-file joins, highlight lifecycle, no-op
  drops outside terminal panes.
- Manual smoke test (user): real Finder drops after a build — including the
  physical→logical coordinate division on 2× displays, the one spot with
  real-world risk jsdom cannot exercise.

## Decisions (defaults confirmed with user)

- Multi-file drops paste **all** paths, space-separated.
- A trailing space follows the pasted path(s).
- Drops outside terminal panes are silent no-ops.
- Hover feedback is the existing cyan ring on the target pane.
