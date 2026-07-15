# Cockpit Improvements Batch — Design

**Date:** 2026-07-15
**Status:** Approved by Kenneth (design conversation, 2026-07-15)

Nine improvements to claude-cockpit: four bug fixes / polish items and five feature
additions. Items are independent of each other except where noted (the
`useElementSize` hook is shared by items 4 and is available to 8).

**Operational constraint:** Kenneth runs cockpit live from the current build. Do NOT
rebuild, relaunch, or close the app as part of this work. Verification is
typecheck + test suite only; Kenneth rebuilds and relaunches himself when he
chooses.

---

## 1. Workspace tab hover: per-kind pane counts

**Problem.** Hovering a workspace tab's pane badge shows "1 pane" / "N panes"
(`WorkspaceBar.tsx`), regardless of whether the panes are notes, plan viewers, or
pomodoros.

**Design.** Extract the per-kind label builder that already exists inline in
`TerminalGrid.tsx` (`countLabel`, "2 terminals · 1 note · 1 timer") into a shared
helper `paneCountLabel(panes: Pane[]): string` in `src/lib/paneCounts.ts`.

- `TerminalGrid` uses the helper for its toolbar label (behavior unchanged).
- `App.tsx` currently passes `counts` (terminals) and `paneCounts` (non-terminal
  panes) as numbers. Replace `paneCounts` with
  `Record<workspaceId, { count: number; label: string }>` — `count` keeps the
  badge's numeric display, `label` (built with the helper from that workspace's
  non-terminal panes) becomes the badge `title` tooltip.
- Singular/plural handled by the helper ("1 note", "2 notes").

**Tests.** Unit tests for `paneCountLabel` (empty, one kind, mixed kinds,
pluralization).

## 2. Fix invisible "Move to workspace" popover on terminals

**Root cause.** `MoveToWorkspaceMenu`'s popover renders inside the pane header.
The header has `backdrop-blur-md`, which creates a stacking context with
`z-index: auto`; within a terminal cell, xterm's positioned internal layers
(`.xterm`, `.xterm-viewport` — opaque background) paint after the header in tree
order and cover the popover. The menu opens but is completely hidden behind the
terminal canvas. Non-terminal panes have no positioned opaque content, which is
why only terminals appear broken.

**Design.** Render the popover through `createPortal(…, document.body)` with
`position: fixed`, anchored to the trigger button's `getBoundingClientRect()`
(computed when opening; closed on scroll/resize as well as outside-click and
Escape, since a fixed-position menu must not drift from its anchor). This also
frees the menu from the pane's `overflow-hidden` clipping in short panes. The
same popover serves both the header button and the right-click-header path
(unchanged `open`/`onOpenChange` contract).

Precedent: the sidebar's project context menu already uses fixed positioning at
cursor coordinates.

**Tests.** RTL: popover element is a child of `document.body` when open; clicking
a workspace target calls `onMove` and closes; outside click closes.

## 3. Terminal scroll: bottom-anchored refits

**Problem.** `scrollSafeFit` (`useTerminal.ts`) preserves the *absolute*
`scrollTop` of `.xterm-viewport` across every refit (pane resize, window resize,
font zoom). When output has arrived since the saved position — e.g. Claude just
painted a question prompt — the viewport is left pinned above the bottom and the
newest lines are hidden until the user manually scrolls.

**Design.** Replace absolute restoration with bottom-anchoring:

- Before fit: `distanceFromBottom = scrollHeight - scrollTop - clientHeight`.
- After fit: if `distanceFromBottom ≈ 0` (at bottom, within one line), scroll to
  the new bottom; otherwise restore the same distance-from-bottom, clamped.
- Extracted as a pure helper (`computeRestoredScrollTop(before, after)`) in
  `src/lib/` so the math is unit-testable; `scrollSafeFit` calls it.

**Honest limitation (documented, not fixed here).** The "can't scroll up through
a tall question list / my multi-line draft" complaint is Claude Code's fullscreen
TUI (`"tui": "fullscreen"` in `~/.claude/settings.json`) redrawing in place:
content that doesn't fit the viewport is never emitted to the PTY, so no
terminal emulator can scroll to it. Cockpit's responsibility — accurate PTY
row/col reporting and always showing the bottom of what Claude draws — is
covered by this fix. If clipping keeps hurting, the lever is the Claude-side
`tui` setting, not cockpit code.

**Tests.** Unit tests for the scroll-restore helper (was at bottom → stays at
bottom after growth; was scrolled up → same distance preserved; clamping).

## 4. Pomodoro compact mode

**Problem.** `PomodoroCell` renders a fixed 144px ring plus controls and duration
editors; in a small pane the layout overflows/scrolls instead of adapting.

**Design.** Approved layout: below a size threshold, swap the body to a
horizontal-bar design:

```
┌─ Pomodoro ──────────┐
│ 24:31  Focus   ▶ ⟳  │
│ ████████████░░░░░░░ │
└─────────────────────┘
```

- One row: time (tabular), phase label, play/pause + reset as icon-only buttons;
  full-width progress bar underneath (phase color, same 250ms transition).
  Duration editors are hidden in compact mode (enlarge the pane to edit).
- Threshold: content area below ~200px height **or** ~240px width renders
  compact; otherwise the existing ring layout (which caps its ring at the
  current 144px and centers as today).
- Implemented with a new `useElementSize(ref)` hook (ResizeObserver, rAF-safe)
  in `src/hooks/` — reusable, and consistent with the codebase's existing
  ResizeObserver patterns.
- Timer semantics, sounds, notifications, and persistence are untouched — this
  is purely a presentational branch on measured size.

**Tests.** `useElementSize` unit test (mock ResizeObserver); PomodoroCell renders
compact vs ring layout by size; compact hides duration editors and keeps
start/pause/reset functional.

## 5. Star chats (sessions)

**Problem.** Long-running important chats can't be marked; closing their terminal
means losing track of them among the sidebar's 20-most-recent sessions.

**Design.**

- **Rust store:** `session_stars.json` in the same cockpit data dir as
  `session_titles.json`, holding a JSON array of starred session ids (stored as
  a set in memory). Mirror the title-override pattern (`workspace/store.rs`):
  `get_session_stars() -> HashSet<String>`,
  `set_session_starred(session_id, starred)` writing the file atomically like
  its sibling. New Tauri command `set_session_starred`; stars are overlaid in
  the existing `get_sessions` command.
- **`SessionInfo` gains `starred: bool`** (serde default false). Sorting in
  `get_sessions`: starred first, then by `last_message` descending within each
  group. **Starred sessions are exempt from the `limit` truncation** — they are
  always included, so a starred chat can never age out of the sidebar.
- **Frontend:** `Session` type gains `starred`. In `Sidebar`'s session rows: a
  star toggle (lucide `Star`), visible on row hover and always visible (filled,
  amber `#f59e0b`) when starred. Clicking toggles via IPC and refreshes
  optimistically. Starred rows render in their sorted (pinned) position from the
  backend; no extra client-side sorting.

**Tests.** Rust: store round-trip, overlay + sort + limit-exemption in
`get_sessions` merge logic. RTL: star toggle calls IPC, starred row shows filled
star.

## 6. First pane in an empty workspace fills the canvas

**Problem.** Every new pane seeds at 520×340 (`seedRect`), so the first terminal
in an empty workspace is a small window the user immediately arranges to "1".

**Design.** When a workspace's pane membership transitions **0 → 1**, seed that
single pane with `tileRects([id], 1, surfaceW, surfaceH)` — identical geometry
to pressing the "1" arrange preset. Later panes keep the staggered `seedRect`
seeding.

- `useCanvasLayout(ids)` gains an optional second argument: a
  `getSurfaceSize(): {w, h} | null` callback. `TerminalGrid` passes a closure
  over its existing `surfaceRef`. The hook's seeding effect runs after render,
  when the ref is attached; if the surface reports 0×0 (shouldn't happen —
  inactive workspaces are `visibility: hidden`, which preserves layout), fall
  back to `seedRect`.

**Tests.** Hook tests: 0→1 fills surface; 0→2 and 1→2 use staggered seeds;
missing/zero surface size falls back.

## 7. Level-up celebration + character card

**Problem.** A level-up is a 1.8s text pulse in the 24px status bar — invisible
in practice (Kenneth has gained ~30 levels without noticing once). Milestones
every 25 levels are only modestly louder.

**Design.** Three pieces, all driven by the existing `usePlayer` state (which
stays where it is, inside `PlayerHud`):

1. **Center-screen burst** (rendered via `createPortal` from `PlayerHud`): on
   `levelUp`, a card scales in at screen center — class × tier art, "LEVEL N",
   class name — with a glow flourish. Ordinary level: ~3s then fades. Milestone:
   larger card, longer (~5s), golden treatment. Pure CSS animations, no new
   dependencies. Pointer events pass through except on the card itself; clicking
   the card opens the character modal. Existing sounds/OS notifications
   unchanged. `usePlayer`'s flash durations lengthen to match (3000 / 5000 ms).
2. **Character card modal:** clicking the status-bar HUD (or the burst card)
   opens a modal (reuse `shared/Modal.tsx`): large art, level, class name +
   blurb, XP bar with exact `xpIntoLevel / xpForLevel` numbers, lifetime stats
   grid (output tokens, user messages, tool calls, sessions, projects — from
   `PlayerStats`), and "next milestone: level N".
3. **Art:** 25 images generated with the `codex-imagegen` skill — 5 classes ×
   5 tiers (levels 1–49, 50–99, 100–149, 150–199, 200+), consistent per-class
   style via reference-image chaining, bundled at `src/assets/player/
   <classKey>-t<1..5>.png`. Helpers in `player.ts`: `tierForLevel(level): 1..5`
   and `artForPlayer(classKey, level): string` (import-mapped, not runtime
   paths). Kenneth is level 224 → tier 5 art immediately.

**Tests.** `tierForLevel` boundaries; `artForPlayer` mapping completeness (every
class × tier resolves); burst renders on levelUp and auto-dismisses (fake
timers); HUD click opens modal with stats.

## 8. `model · effort · tokens` in the terminal header

**Problem.** Kenneth checks `/model`, `/effort`, `/context` by hand. The header
pill shows only tokens.

**Design.**

- **Model** is already extracted per-turn by `get_session_context`
  (`SessionContext.model`) and updates when `/model` changes mid-session — it's
  just unused by the UI. New `formatModelShort(id)` in `src/lib/constants.ts`:
  `claude-fable-5` → "Fable 5", `claude-opus-4-8` → "Opus 4.8",
  `claude-haiku-4-5-20251001` → "Haiku 4.5" (strip `claude-` prefix, drop a
  trailing date segment, capitalize family, dot-join version digits, tolerate
  a `[1m]` suffix). Unknown ids fall back to the raw id.
- **Effort:** `SessionContext` gains `effort: Option<String>`. The existing
  transcript tail-scan additionally recognizes the recorded `/effort` command
  stdout — user-type lines containing `Set effort level to <level>` — and keeps
  the last match (same scraping precedent as the "Session renamed to:"
  detection). When the tail contains none, fall back to `effortLevel` from
  `~/.claude/settings.json`. Known limitation: an `/effort` change that has
  scrolled past the 1 MiB tail window falls back to the settings default; this
  is display-only and self-corrects on the next change.
- **Display:** the `ContextPill` zone in `TerminalCell`'s header becomes
  `Fable 5 · high · 74k` — model and effort in muted text, tokens keeping the
  existing danger-tier colored pill. Rendered only when session context exists
  (unchanged gating).
- **Responsive discard (priority: effort first, model second, tokens last):**
  the terminal cell root becomes a CSS size container (`container-type:
  inline-size`; it already has a definite canvas-assigned width, so this is
  safe); `@container` rules in `globals.css` hide the effort span below ~420px
  and the model span below ~340px. No JS measurement.

**Tests.** Rust: effort-line parsing (present, absent, multiple — last wins),
settings fallback. TS: `formatModelShort` cases; pill renders model/effort/token
text.

---

## Cross-cutting

- **Branch:** one feature branch off `main` (e.g. `feature/cockpit-improvements-batch`),
  merged after review. Items are independent; implementation order:
  quick fixes (1, 6, 2, 3) then features (4, 8, 5, 7).
- **TDD** per project convention; the Stop-hook gate enforces typecheck + tests.
- **No rebuild / no relaunch / no app close** (Kenneth is using cockpit live).
- **No new runtime dependencies.** Portals, ResizeObserver, container queries,
  and CSS animations are all platform features.
- **Persistence:** only item 5 adds a persisted file (`session_stars.json`),
  following the existing store pattern exactly.
