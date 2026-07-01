# Move Pane to Workspace + "Columns" Arrange Preset — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan

## Summary

Two small canvas enhancements:

1. **Move a pane to another workspace** — any pane (terminal or note) can be moved
   to a different workspace tab via a header button *and* a right-click on the
   header, both opening a lightweight inline popover listing the other workspaces.
   After moving, the user stays on the current workspace (the pane just leaves).
2. **"Columns" arrange preset** — a new toolbar button that lays every pane out as
   a full-height column, side by side (available width ÷ pane count).

## Feature A — Move pane to another workspace

### State / logic

- `useTerminals` gains `moveTerminal(id: string, workspaceId: string)` — a
  `setTerminals` map updating the terminal's `workspaceId`, mirroring the existing
  `rename`.
- `useNotes` gains `moveNote(id: string, workspaceId: string)` — same shape; the
  hook's existing persistence effect writes the change to disk automatically.
- `App` gains `movePane(id: string, workspaceId: string)` that routes by pane kind
  (note → `moveNote`, terminal → `moveTerminal`), mirroring the existing
  `closePane` / `renamePane` routers.

### UI — shared `MoveToWorkspaceMenu` component

A single component used by both `TerminalCell` and `NoteCell` so the popover logic
isn't duplicated.

- Props: `currentWorkspaceId: string`, `workspaces: Workspace[]`,
  `onMove: (workspaceId: string) => void`.
- Renders a small "move" icon button in the pane header. Clicking toggles a popover
  listing every workspace **except** `currentWorkspaceId`; clicking a row calls
  `onMove(targetId)` and closes the popover.
- If there are no other workspaces (only one exists), the button is not rendered
  (nothing to move to).
- The popover is a plain absolutely-positioned element anchored below-left of the
  button (no portal). Edge clipping at the canvas boundary is acceptable for this
  UI; below-left placement minimizes it.
- Closes on outside click / Escape.

### Wiring

- `workspaces: Workspace[]` and `onMovePane: (id, workspaceId) => void` thread from
  `App` through `TerminalGrid` → `TerminalCanvas` → each cell. The cells already
  receive their `terminal` / `note` object, so they know their own `workspaceId`.
- Right-click: the cell header's `onContextMenu` handler (with `preventDefault`)
  opens the same popover.

### Drag-handle bug fix (in scope)

The header is a drag handle via `onHeaderPointerDown`, which currently calls
`startGesture` on a pointer-down from **any** mouse button — so a right-click would
begin a move gesture. Guard the header pointer-down with `if (e.button !== 0)
return;` so only a left button starts a drag; right-click is free to open the menu.

## Feature B — "Columns" arrange preset

- A new toolbar button in `TerminalGrid` calls the existing `arrange(paneCount)`
  (i.e. `arrange(panes.length)`).
- No new tiling math: `tileRects(ids, cols, w, h)` already computes
  `columns = min(n, cols)` and `rows = ceil(n / columns)`, so passing `cols = n`
  yields `columns = n, rows = 1` — every pane a full-height column, width =
  `(viewportW − margins − gaps) / n`.
- Icon: `Columns3` (lucide); tooltip "Fit all as full-height columns".
- If pane count is large enough that each column would fall below `MIN_W` (240px),
  columns stay full-height and the canvas scrolls horizontally (existing
  `Math.max(MIN_W, cellW)` behavior). Acceptable.

## Testing

- Unit (`useNotes.test.ts`): `moveNote` changes exactly the target note's
  `workspaceId` and leaves the others unchanged.
- Unit (new `useCanvasLayout.test.ts`): `tileRects(ids, ids.length, w, h)` produces
  one row — all rects share the same `y`, `x` is strictly increasing, and every
  rect has the full viewport height (minus margins).
- `moveTerminal` on `useTerminals` is **not** unit-tested: that hook has no test
  harness and the function is a trivial one-line map identical to the tested
  `moveNote`; adding a harness for it would be scope creep.
- Menu rendering, the header button, right-click, and the drag-guard are verified
  by `npm run build` + manual check.

## Risks / honest flags

- The popover is a non-portaled, header-anchored element; extreme canvas-edge
  positions could clip it. Below-left placement is the mitigation; a portal-based
  menu is deliberately out of scope (YAGNI for this UI).
- "Columns" reuses `arrange(n)`; with many panes the columns get narrow and the
  canvas scrolls horizontally — this is the intended, user-accepted behavior.
