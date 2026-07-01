# Notes Canvas Pane — Design

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan

## Summary

Add a **note pane** as a first-class citizen of the Canvas, alongside terminals.
A note is a draggable/resizable window whose body is a lightweight WYSIWYG editor
for prose, bullet lists, and clickable checkbox to-do items — no raw markdown
syntax typing required. Notes are scoped and persisted per-workspace, exactly like
terminals, so they survive relaunch through the existing session-restore flow.

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

### Persistence: existence vs. content

A note has two distinct pieces of persisted state, stored separately:

1. **Existence + position + workspace + label + color** — rides in the per-window
   session state. Add a `notes: Vec<PersistedNote>` field to the Rust `WindowState`
   struct with `#[serde(default)]` so existing session files (which lack the key)
   still deserialize.

   ```rust
   struct PersistedNote {
       id: String,
       label: String,
       color: String,
       workspace_id: Option<String>,
   }
   ```

   Because note existence lives in `WindowState` next to terminals, the existing
   restore modal, multi-window recovery, and workspace flows cover notes for free —
   there is no separate restore path.

2. **Text content** — stored in its own file, `~/.claude-cockpit/notes/{id}.json`,
   holding TipTap/ProseMirror document JSON. Three new Tauri commands:
   - `get_note_content(id) -> Option<serde_json::Value>` (returns null/None if the
     file does not exist yet)
   - `save_note_content(id, content)` — writes the JSON file (called debounced
     from the editor)
   - `remove_note_content(id)` — deletes the file (on note delete and on session
     discard)

   Storing content separately keeps session JSON small and decouples note text
   from window lifecycle. Content is ProseMirror JSON, not a markdown string —
   lossless and the format TipTap natively loads and saves.

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

**Content loading/saving:**
- On mount, `NoteCell` lazily calls `get_note_content(id)` and initializes the
  editor (empty doc if none).
- Edits mark the note dirty and schedule a debounced `save_note_content` (~500ms).
- On unmount, flush any pending save so no keystrokes are lost.

### Hooks & App wiring

- New **`useNotes`** hook, structured to parallel `useTerminals`:
  - Owns note panes state.
  - `addNote`, `renameNote`, `removeNote`.
  - Workspace assignment and reassignment (mirror of the terminal logic).
  - Restore: reads `WindowState.notes` on startup and recreates the panes; each
    `NoteCell` loads its own content lazily.
- **`App.tsx`** composes `terminals` + `notes` into one `panes` array, filtered by
  the active workspace, and passes it to the canvas. Persistence saves both
  terminals and notes into the single `WindowState`.

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
  `useTerminals.deleteWorkspace`.
- **Session discard** removes note content files in addition to clearing session
  state.

## Testing

This repo currently has **no frontend test runner** (no Vitest/Jest, no test
script, no existing test files) and **no `.claude/gate.config`**. Rust `cargo test`
works out of the box. The plan therefore includes bootstrapping a frontend harness.

- **Bootstrap Vitest** as an explicit first step: add `vitest` (+ jsdom /
  `@testing-library/react` as needed) to devDependencies, a `vitest.config.ts`, and
  a `"test"` script. This is real setup work, not a line item.
- Unit tests for `useNotes`: add, rename, remove, workspace reassignment on
  workspace delete, and restore from `WindowState.notes`.
- Unit test for the note content debounce/flush behavior (edits coalesce; unmount
  flushes).
- Rust test (`cargo test`, no new infra): `WindowState` containing `notes`
  round-trips through serde, and an old session file without the `notes` key still
  deserializes (via `#[serde(default)]`).

The typecheck floor stays `npm run build` (`tsc`).

## Risks / honest flags

- **TipTap is a real dependency** (ProseMirror-based, several packages). It is the
  well-tested route for "click a checkbox, Enter continues it" without hand-rolling
  a contenteditable (which would be the fragile path this project's standards
  forbid). Accepted deliberately.
- The **close-confirm on notes** is a small behavioral divergence from terminals;
  judged warranted because a note's text is a user artifact.
