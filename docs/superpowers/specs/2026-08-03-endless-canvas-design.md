# Endless Canvas: Pan + Zoom — Design

**Date:** 2026-08-03
**Status:** Draft — pending user review

## Problem

The workspace canvas already grows past the viewport, but navigating it means
scrollbars, and there is no way to see the whole workspace at once. Wanted:
pan by dragging empty space, zoom out to an overview, jump back in.

## Hard constraint (user)

**The default view (z = 1) must look and behave exactly as today** — the
existing overflow-auto scroller, scrollbars, pane dragging, resizing, and
PTY sizing are untouched until the user actually zooms. What the canvas
looks like *while zoomed out* is free to differ as much as it needs to
(cards, hidden chrome, anything); the invariant applies only to the
default, un-zoomed state. Zoom/pan is a layer on top, inert until used.

## Decisions (from brainstorm)

- Pan + zoom designed together; world-space coordinate model from the start.
- Zoomed-out purpose: **overview + jump** — below a threshold, panes render
  as crisp stylized cards (title, project color, status), not scaled xterm.
- Zoom range 15%–100%. No over-zoom (font size covers "bigger").

## Design

### Coordinate model

Pane rects stay in world coordinates exactly as today (`layout: Record<id,
Rect>` — unchanged). The scroller's inner surface gets one wrapper:

- `transform: scale(z)`, `transform-origin: 0 0`; the surface's laid-out
  width/height are multiplied by `z` so scroll extents stay correct.
- **When z === 1 the wrapper renders no transform at all** (no style
  attribute, no containing-block change — the identity path is literally
  today's DOM, preserving the hard constraint).
- Zoom is purely visual: PTY cols/rows derive from world-space rects, so no
  terminal resize ever fires during zoom or pan.

### Gestures

- **Pan:** pointer-drag on empty canvas drives `scrollLeft/scrollTop`
  (works identically at every z, including 1 — it's just scrolling, which is
  why the z = 1 behavior can't regress). Two-finger scroll keeps its native
  scrolling behavior.
- **Zoom:** pinch (trackpad) and Cmd+scroll zoom toward the cursor: after
  changing z, scroll offsets are adjusted so the world point under the
  cursor stays put. The anchor math is a pure function
  (`zoomAt(view, cursor, nextZ) -> {z, scrollLeft, scrollTop}`) — unit
  tested.
- **Jump:** double-click an overview card → animate z back to 1 centered on
  that pane and focus it. A "fit all" toolbar button picks the z (clamped to
  [0.15, 1]) and scroll that shows every pane.

### Overview cards

Below z = 0.6, each pane's live content is hidden (`visibility: hidden` —
panes stay **mounted**, terminals keep running, screens stay live exactly
like inactive workspaces already do in `App.tsx`) and a card overlay renders
in its place: pane title, project color bar, status glyph
(running/idle/attention), kind icon for non-terminal panes. Card typography
is counter-scaled (`font-size: base / z`) so labels rasterize crisply at any
zoom.

At z ≥ 0.6, cards are absent and live panes render normally (they are
CSS-scaled between 0.6 and 1 — acceptable for a transient zoom gesture;
sustained work happens at 1).

### What zoom does NOT change

Pane drag/resize gestures are disabled while z < 1 (the overview is for
navigation; editing layout happens at 100% — this avoids scaling-corrected
gesture math entirely in v1). Keyboard shortcuts, status logic, persistence:
untouched. z and scroll are per-workspace, in-memory only (not persisted).

## Error handling

- Zoom clamped to [0.15, 1]; NaN/0-dimension guards in `zoomAt` (empty
  workspace → "fit all" is a no-op at z = 1).
- WebGL xterm panes: hidden via `visibility`, never unmounted/remounted, so
  no renderer re-init churn.

## Testing

- `zoomAt` / `fitAll` pure functions: anchor preservation, clamping, empty
  input — unit tested (the whole risk concentrates here).
- Card-threshold rendering: component test — below threshold cards render
  and xterm containers are visibility-hidden; at z = 1 the DOM matches
  today's (no wrapper style, no cards).
- Gesture wiring + feel: manual smoke checklist (user), since jsdom has no
  real wheel/pinch semantics.

## Out of scope (v1)

Minimap; persisting zoom state; zoomed-out pane dragging; snapshot previews
of terminal content (cards only); animating between workspaces.
