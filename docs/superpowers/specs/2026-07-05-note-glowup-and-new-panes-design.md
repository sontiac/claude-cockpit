# Note Glow-Up + Markdown Viewer & Pomodoro Panes — Design

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## Summary

Four pieces, delivered in order as separate commits:

1. **Note glow-up** — a full formatting toolbar (buttons for everything, no
   markdown knowledge required), styled headings, and a much nicer completed-task
   treatment centered on green: custom animated checkboxes and a live progress
   bar in the note toolbar.
2. **Pane infrastructure generalization** — `useNotes` becomes `usePanes`,
   persisting a discriminated pane descriptor so new non-terminal pane kinds
   slot in without duplicating persistence plumbing.
3. **Markdown viewer pane** — paste a file path (Claude's plans are usually
   `.md`), see it rendered; auto-reloads when the file changes on disk.
4. **Pomodoro pane** — ring countdown, work/break cycles, sound + attention
   notification on completion.

## Motivation

The note editor shipped deliberately minimal (see 2026-06-30 spec). In use, the
gaps are visual: headings render unstyled, completed tasks are a harsh
strikethrough + opacity snap, and every feature requires knowing a markdown
shortcut. Separately, the user reviews Claude-written `.md` plans constantly and
wants them readable inside the cockpit, and wants a pomodoro timer as a pane.

## Non-goals (YAGNI)

- No image paste/embed in notes (future round — needs backend file storage).
- No web preview pane, no clipboard-stack pane (considered, cut).
- No file *browser* in the markdown viewer — it opens exactly the path given.
- No editing in the markdown viewer — read-only rendering.
- No cross-window pomodoro sync; a timer belongs to its window.

---

## Part 1 — Note glow-up

### Toolbar

Grouped left-to-right, `·` = divider:

> H1 H2 H3 · B I S · highlight · checklist · bullet list · blockquote · hr · undo redo

- Bold/italic/strike/headings/blockquote/hr are already in StarterKit — they need
  buttons and CSS only. Markdown input rules keep working as a bonus, never a
  requirement. Cmd+B / Cmd+I come free from TipTap.
- Highlight via `@tiptap/extension-highlight`, single soft-yellow style (no
  color picker — YAGNI).
- Empty-note placeholder via `@tiptap/extension-placeholder`
  ("Write something — or use the toolbar above…").
- Active states: toolbar buttons reflect the current selection (existing
  `ToolbarButton` `active` prop pattern).

### Completed tasks (the centerpiece)

- **Custom checkboxes** (CSS on the TipTap task-item checkbox, no new deps):
  rounded square, hollow/muted border unchecked; checked = filled green
  (`#10b981`, the app's existing terminal green) with a white ✓ drawn via
  CSS, plus a quick pop (scale) animation on check.
- **Checked text**: transitions (~200ms) to muted, green-tinted color with
  strikethrough — replacing today's instant `opacity: 0.6` snap.
- **Progress bar in the note toolbar**: slim green fill + `3/7` count, computed
  from the TipTap doc on each update (count `taskItem` nodes and their
  `checked` attr). Hidden when the note has no tasks. At 100%: bar fully green,
  count swaps to a ✓ glyph.

### Styling additions (`globals.css`, `.note-prose` scope)

Headings (sizes/weights/margins, H1 tinted with the note's accent `color` via a
CSS custom property set on the cell), blockquote (accent-colored left bar),
`hr`, highlight mark, checkbox/task styles above.

## Part 2 — Pane infrastructure

Persistence today is note-specific: `PersistedNote[]` in a per-window file, plus
per-note content files. Generalize (backwards compat explicitly not required):

```ts
// runtime
interface CanvasPaneBase { id: string; label: string; color: string; workspaceId: string }
type CanvasPane =
  | (CanvasPaneBase & { kind: "note" })
  | (CanvasPaneBase & { kind: "mdviewer"; path: string | null })
  | (CanvasPaneBase & { kind: "pomodoro"; workMinutes: number; breakMinutes: number });

// the canvas union becomes
type Pane = ({ kind: "terminal" } & TerminalInfo) | CanvasPane;
```

- `useNotes` → **`usePanes`**: same load/persist/closingRef/forget lifecycle,
  same backend commands. Rust-side, `PersistedNote` (a typed serde struct in
  `notes/store.rs`) becomes `PersistedPane`: adds
  `#[serde(default = "note_kind")] kind: String` plus optional per-kind fields
  (`path: Option<String>`, `work_minutes`/`break_minutes: Option<u32>`), all
  `#[serde(default)]`. The store never interprets `kind` — it stays a dumb
  persistence record; the discriminated union lives in TypeScript where it's
  consumed. Existing files (no `kind`) deserialize as notes via the default.
- Note content files (`get/save/remove_note_content`) unchanged, still keyed by
  pane id, only used by `kind: "note"` panes.
- `App.tsx` merges terminals + canvas panes per workspace as today; `NoteCell`
  gains siblings `MarkdownViewerCell` and `PomodoroCell` chosen by `kind` in
  `TerminalCanvas`.
- Existing persisted notes files from before the rename load as notes via the
  serde `kind` default above — a principled default, not a migration shim.

## Part 3 — Markdown viewer pane

- **Header**: the standard pane header (drag, rename, move, close) plus the body
  top shows a path input — paste an absolute path, Enter loads it. Invalid/missing
  file shows an inline error state with the path kept editable.
- **Backend**: new Rust command `read_text_file(path) -> { content, mtime_ms }`.
  Plain read, no allowlist gymnastics — this is a local cockpit and the user
  pastes paths deliberately. Size-guard: refuse > 2 MB with a clear error.
- **Auto-reload**: while the pane is mounted and its file is set, poll mtime
  every 2 s (`read_text_file` is called only when mtime changed — poll uses a
  lighter `stat_file(path) -> mtime_ms` command). When Claude rewrites a plan,
  the pane refreshes itself. Polling over a watcher crate: one stat every 2 s
  per open viewer is negligible and avoids a new native dependency; revisit if
  viewers multiply.
- **Rendering**: `react-markdown` + `remark-gfm` (tables + task lists — Claude's
  plans use both), styled via a `.md-prose` stylesheet consistent with
  `.note-prose` (same heading scale, code blocks in the terminal font).
- **Persistence**: the pane and its `path` persist via Part 2, so plan viewers
  survive restarts and reload their file on launch.

## Part 4 — Pomodoro pane

- **UI**: large SVG ring countdown (mm:ss centered), phase label (Focus /
  Break), start/pause/reset buttons, and editable work/break durations
  (default 25/5) shown when idle. Session dots (4-cycle tally) beneath the ring.
- **Color**: work ring in green `#10b981`, break ring in the app cyan; ring
  drains as time elapses.
- **Completion**: on phase end, play a sound via the existing `useSounds` and
  route through the existing attention/notification path so an unattended
  workspace tab lights up; auto-advances to the next phase but paused (user
  starts the break — no surprise timers).
- **State**: countdown runs off a stored `endsAt` timestamp (survives re-render
  and workspace switches; interval only ticks the display). Runtime-only —
  restarting the app resets the timer; durations persist via Part 2.
- **Timing correctness**: elapsed time derives from `Date.now()` against
  `endsAt`, never from accumulated interval ticks, so background throttling
  can't drift it.

## Testing

- **Part 1**: unit tests for the task-progress counter (doc JSON → `{done, total}`),
  covering nested task lists and no-task docs. Checkbox/animation styling is
  CSS — verified visually by the user (no rebuild by Claude; user runs live).
- **Part 2**: unit tests for `usePanes` persistence round-trip (mirroring the
  existing `useNotes.test.ts` suite, which it replaces), including the missing-
  `kind` default and per-kind config fields.
- **Part 3**: unit test for the mtime-poll hook logic (mocked IPC): reload fires
  only on mtime change; error state on read failure. Rust command follows the
  existing store-command test/style conventions.
- **Part 4**: unit tests for the timer reducer (`endsAt` math, phase
  transitions, pause/resume, cycle tally).

## Delivery

Four commits in order (notes → infra → mdviewer → pomodoro), each leaving the
app fully working. New deps: `@tiptap/extension-highlight`,
`@tiptap/extension-placeholder`, `react-markdown`, `remark-gfm`.
