# Notes Canvas Pane — Design

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan

## Summary

Add a **note pane** as a first-class citizen of the Canvas, alongside terminals.
A note is a draggable/resizable window whose body is a lightweight WYSIWYG editor
for prose, bullet lists, and clickable checkbox to-do items — no raw markdown
syntax typing required. Notes are scoped per-workspace and persisted to their own
durable files (separate from the terminal session), so they quietly reload on every
launch — independent of the terminal recovery prompt.

## Motivation

The user wants to track notes and to-do lists inside the cockpit instead of an
external app, positioned next to their Claude sessions on the canvas. The canvas
was already built to anticipate this — see the comment in `TerminalCanvas.tsx`
("leaving room for non-terminal panes (notes, to-do) to live here later").

## Non-goals (YAGNI)

- No global/shared note library or note picker — notes belong to the workspace
  they're created in.
- No raw markdown authoring (typing `##`, `**`, etc.). Only the basics: bullets,
  checkboxes, and their auto-continuation.
- No rich media, tables, images, or collaborative editing.
- No separate "Tasks" pane type — a single note holds both prose and checkboxes.

## Architecture

### The Pane abstraction

Today the canvas iterates `TerminalInfo[]`. Generalize to a discriminated union so
the canvas can host both terminals and notes:

```ts
type Pane =
  | ({ kind: "terminal" } & TerminalInfo)
  | { kind: "note"; id: string; label: string; color: string; workspaceId: string };
```

- `TerminalGrid` and `TerminalCanvas` accept `panes: Pane[]` and render a
  `TerminalCell` for `kind === "terminal"` and a new `NoteCell` for
  `kind === "note"`.
- `useCanvasLayout` is already keyed by pane id, so mixed terminal/note ids need
  no change to the layout, drag, resize, or arrange machinery.
- The canvas remains the single window system — no parallel notes layer.

### Persistence: separate from the terminal session (deliberate)

**Key decision (revised from the initial draft):** notes do **not** ride inside
`WindowState` / the terminal recovery flow. Terminals and notes have different
persistence semantics:

- A terminal is a **live process**. Not restoring it loses a running Claude
  session — hence the un-dismissable, double-confirm recovery modal. It is at-risk,
  ephemeral session state.
- A note is **durable text on disk**. It is never at risk and should quietly reload
  every launch. Coupling it to the recovery modal would be wrong: notes would appear
  in the "Recover N terminals?" count, and **Discard** would delete the user's
  to-do list along with the abandoned terminals.

So notes get their own persistence path, keyed per window label exactly like
`WindowState`, and `useTerminals` plus the delicate multi-window restore code stay
**untouched**. A note has two pieces of persisted state, stored separately:

1. **Pane list (existence + placement)** — `~/.claude-cockpit/notes/windows/{label}.json`,
   one file per window label. An array of `PersistedNote`:

   ```rust
   struct PersistedNote {
       id: String,
       label: String,
       color: String,
       workspace_id: Option<String>,
   }
   ```

   This references `workspace_id` the same way `PersistedTerminal` does — workspaces
   themselves still live only in `WindowState`, so there is no second source of
   truth for workspace identity. The pane list is loaded on launch **independently**
   and is **not** gated by the recovery modal (notes reload immediately, whatever
   the user chooses for their terminals). Multi-window works because each window
   loads its own `{label}.json`.

2. **Text content** — `~/.claude-cockpit/notes/content/{id}.json`, holding
   TipTap/ProseMirror document JSON. Content is ProseMirror JSON, not a markdown
   string — lossless and the format TipTap natively loads and saves.

**Tauri commands (new `notes` module):**
- `get_window_notes(label) -> Vec<PersistedNote>` (empty if no file)
- `save_window_notes(label, notes)` — writes the per-window pane list
- `get_note_content(id) -> Option<serde_json::Value>` (None if no file yet)
- `save_note_content(id, content)` — writes the content file (debounced from editor)
- `remove_note_content(id)` — deletes a content file (on note delete)
- `clear_notes()` — removes all note pane-list and content files (called on session
  discard, alongside `clear_session`)

Both `label` and `id` are validated with the same filename-safety check the
workspace store uses (`is_safe_label`) so a value can never escape the notes dir.

Because notes live outside `WindowState`, `useNotes` has its own small
"loaded" gate (mirroring `persistArmed`) so the empty initial React state cannot
overwrite the saved pane list before the load completes.

### The note editor (`NoteCell`)

`NoteCell` mirrors `TerminalCell`'s chrome: a draggable header with the note label
and a close button, same glass styling and active-state treatment. Its body is a
TipTap editor instead of an xterm instance.

**Dependencies added (TipTap v3, currently 3.27.x — supports `react@^19`):**
- `@tiptap/react`
- `@tiptap/starter-kit`
- `@tiptap/extension-task-list`
- `@tiptap/extension-task-item`

Pin to v3. In v3 some list extensions are bundled into StarterKit; the exact
task-list package split (separate packages vs. bundled) is confirmed at install
time and does not affect the design.

**Editor behavior (matches the user's ask):**
- A slim toolbar with a few buttons: checkbox, bullet, and undo/redo.
- Input rules: typing `*` + space auto-starts a bullet; `[]` + space auto-starts a
  checkbox item.
- **Enter** on a list line continues the list; Enter on an empty list line exits
  the list.
- Click a checkbox to toggle done; done items render with strikethrough.
- No raw markdown syntax (`##`, etc.) is needed or surfaced.

**Content loading/saving (`useNoteContent(id)` hook, used by `NoteCell`):**
- On mount, lazily calls `get_note_content(id)` and initializes the editor (empty
  doc if none).
- Edits schedule a debounced `save_note_content` (~500ms).
- On unmount, flushes any pending save so no keystrokes are lost.
- Factored as a small standalone hook so the debounce/flush logic is testable in
  isolation, separate from the TipTap editor UI.

### Hooks & App wiring

- New **`useNotes`** hook, structured to parallel `useTerminals` but owning only the
  note pane list (never touching `WindowState` / terminal recovery):
  - Owns note panes state (`{id, label, color, workspaceId}[]`).
  - `addNote`, `renameNote`, `removeNote` (remove also calls `remove_note_content`).
  - Workspace assignment and reassignment on workspace delete (mirror of the
    terminal logic).
  - Own load-on-mount from `get_window_notes(label)` and own debounced
    `save_window_notes(label, …)` writer, gated by an internal `loaded` flag so the
    empty initial state can't clobber the saved file.
  - `discardNotes()` — clears local state and calls `clear_notes()`; wired into the
    recovery modal's Discard so a discarded session also drops notes.
- **`App.tsx`** composes `terminals` + `notes` into one `panes` array **per
  workspace** (the canvas is instantiated per workspace in `App.tsx:251`), and
  passes it to each `TerminalGrid`. The RestoreModal's `onDiscard` calls both
  `discard()` (terminals) and `discardNotes()`.

### Spawn UX & counts

- A distinct **"New Note"** button in the canvas toolbar (next to the "+" terminal
  button) and in the Sidebar.
- Keyboard shortcut: **Cmd+Shift+N**.
- Counts read distinctly: the canvas toolbar shows e.g. `2 terminals · 1 note`;
  the WorkspaceBar tab count includes notes (with a small note glyph) so a
  workspace containing only notes is not shown as empty.

### Deletion & edge cases

- **Closing a note pane** asks a lightweight confirm ("Delete this note?") because
  the text is the artifact; on confirm the pane is removed and its content file
  deleted via `remove_note_content`. (This is an intentional divergence from
  terminals, which close without confirm.)
- **Deleting a workspace** reassigns its notes to the fallback workspace, mirroring
  `useTerminals.deleteWorkspace`. (Workspaces are owned by `useTerminals`; the note
  reassignment is driven by `App` observing the surviving workspace set.)
- **Session discard** clears all note files (`clear_notes()`) alongside the terminal
  session, so Discard is a true clean slate.
- **Notes are excluded from the recovery modal.** They reload immediately on launch
  regardless of the Recover/Discard choice, because they are durable data, not
  at-risk live sessions.

## Testing

This repo currently has **no frontend test runner** (no Vitest/Jest, no test
script, no existing test files) and **no `.claude/gate.config`**. Rust `cargo test`
works out of the box. The plan therefore includes bootstrapping a frontend harness.

- **Bootstrap Vitest** as an explicit first step: add `vitest` (+ jsdom /
  `@testing-library/react` as needed) to devDependencies, a `vitest.config.ts`, and
  a `"test"` script. This is real setup work, not a line item.
- Unit tests for `useNotes`: add, rename, remove, workspace reassignment on
  workspace delete, and restore from a loaded pane list.
- Unit test for `useNoteContent` debounce/flush behavior (edits coalesce; unmount
  flushes).
- Rust tests (`cargo test`, no new infra): per-window note-list round-trips through
  serde; content write/read/remove works; `clear_notes` removes everything; and the
  filename-safety check rejects a traversal-style `label`/`id`.

The typecheck floor stays `npm run build` (`tsc`).

## Risks / honest flags

- **TipTap is a real dependency** (ProseMirror-based, several packages). It is the
  well-tested route for "click a checkbox, Enter continues it" without hand-rolling
  a contenteditable (which would be the fragile path this project's standards
  forbid). Accepted deliberately.
- The **close-confirm on notes** is a small behavioral divergence from terminals;
  judged warranted because a note's text is a user artifact.
- **Notes use a second persistence path** (`notes/…` files + their own save effect)
  rather than reusing `WindowState`. This is mild duplication of the per-window save
  pattern, accepted deliberately: it keeps the freshly-shipped multi-window recovery
  code untouched and gives notes the correct "durable document, not at-risk session"
  semantics (see the Persistence section).
