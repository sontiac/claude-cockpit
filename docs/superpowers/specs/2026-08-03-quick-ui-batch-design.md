# Quick UI Batch — Design

**Date:** 2026-08-03
**Status:** Approved by Kenneth (conversation), pending spec review

Three related UI changes to reclaim vertical space and improve the sidebar:

1. Merge the three top rows (titlebar, workspace bar, buttons bar) into two.
2. Make the sidebar hideable with edge-hover reveal and a pin.
3. Show live per-project terminal counts and full-name tooltips in the sidebar.

Out of scope (tracked separately): drag-and-drop file handling, endless canvas
pan/zoom, voice agent.

## 1. Top bar merge

### Current state

Three stacked rows above the canvas:

- `src/components/layout/TitleBar.tsx` — custom titlebar (the window has
  `decorations: false`): drag region, "Claude Cockpit" label, custom
  minimize/maximize/close buttons.
- `src/components/layout/WorkspaceBar.tsx` — workspace tabs with pane counts,
  rename/delete/reorder, `+` new workspace, new-window button.
- The buttons bar — first row inside
  `src/components/terminal/TerminalGrid.tsx` (pane-count label, arrange
  presets, new note/plan/timer/terminal, provider menu). One grid per
  workspace is stacked in `App.tsx`; only the active one is visible, so this
  row already behaves like a single second bar.

### New state

A single `TopBar` component (`src/components/layout/TopBar.tsx`) replaces
`TitleBar` and `WorkspaceBar` as the only chrome row above the buttons bar:

- **Left:** workspace tabs, carried over from `WorkspaceBar` with identical
  behavior — active indicator, per-workspace counts, double-click rename,
  delete, HTML5 drag reorder, `+` new workspace, new-window button.
- **Middle:** flexible empty stretch acting as the window drag region.
  `mousedown` → `appWindow.startDragging()`; double-click → toggle maximize.
  Interactive children opt out via the existing `data-nodrag` closest-check
  pattern from `TitleBar`.
- **Right:** the custom minimize / maximize / close buttons, moved from
  `TitleBar` unchanged. Close continues to call the `onClose` prop so
  `App.tsx` keeps its last-window-quits logic.

Removals (no compatibility shims, per repo policy):

- `TitleBar.tsx` and `WorkspaceBar.tsx` are deleted; `App.tsx` renders
  `TopBar` in their place with the union of their current props.
- The "Claude Cockpit" center label is dropped entirely.

The buttons bar inside `TerminalGrid` does not move. Its pane-count label and
buttons are unchanged.

Secondary windows use the same `App` shell, so they get the merged bar with no
extra work.

## 2. Hideable sidebar

### Current state

`src/components/layout/Sidebar.tsx` is always visible, docked left, pushing
the workspace area right.

### New state

The sidebar has a persisted boolean **pinned** state:

- **Pinned** — exactly today's behavior: docked, pushes content.
- **Unpinned** — the default (`pinned: false` when the stored window state
  has no value): the sidebar is fully hidden and the canvas takes the full
  width. A hot strip (~6px, full height of the content row, left edge)
  detects mouse entry and slides the sidebar in as an **overlay** above the
  canvas (absolute positioning, elevated z-index; canvas does not reflow).
  On mouse-leave of the overlay, it slides out after a ~300ms delay so brief
  exits don't flicker. While any canvas pane drag/resize gesture is in
  progress, the hot strip is inert (no accidental reveal when dragging a pane
  toward the left edge).

Controls:

- Pin/unpin toggle button in the sidebar header.
- **Cmd+B** toggles pinned, registered alongside the existing app shortcuts
  in `App.tsx`.

Persistence: `pinned` is stored with the rest of the window state in the
existing Rust-side window-state store, so it survives restarts and is
per-window.

## 3. Sidebar counts and tooltips

### Live per-project terminal count

- `App.tsx` derives `projectTerminalCounts: Map<string, number>` from the
  window's live `terminals` state (each terminal already carries
  `project_id`), counting terminal panes only — notes, plan viewers, and
  timers are excluded. Scope is **this window's workspaces** (each window's
  sidebar reflects that window; no cross-window aggregation).
- Passed to `Sidebar` as a prop; the row renders `name (3)` in the existing
  muted style. When the count is zero the suffix is omitted entirely (no
  `(0)`).
- This is unrelated to the project's `terminals` config field (how many to
  launch), which is untouched.

### Full-name tooltip

- The project-name element gets a native `title` attribute with the full
  project name, covering truncated long names. No custom tooltip component.

## Error handling

No new failure modes are introduced: all state is derived or local UI state.
The only persistence change is one boolean added to the existing window-state
snapshot; a snapshot missing the field loads as `pinned: false` (hidden), the
default.

## Testing

- The count derivation is a pure function (`terminals[] → Map<projectId,
  count>`) and gets a Vitest unit test (the repo already runs Vitest via
  `npm test`).
- Interactive behavior (drag region, double-click maximize, hover reveal,
  pin persistence, tab reorder still working in the new bar) is verified
  manually in the running app.

## Decisions log

- Two bars, not one: workspace tabs + window controls on top, buttons bar
  below (Kenneth's layout; scales better with many workspaces than a single
  merged row).
- Sidebar: edge hover + pin, Cmd+B, per-window persisted pinned state.
- Counts: current window only; terminals only; omit when zero.
- Tooltip: native `title` attribute.
