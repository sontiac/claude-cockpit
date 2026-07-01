# Notes Canvas Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a note pane — a draggable canvas window with a lightweight WYSIWYG editor for prose, bullets, and clickable checkbox to-dos — alongside terminals, persisted to its own durable per-window files.

**Architecture:** The canvas is generalized from a list of terminals to a list of *panes* (a `kind`-discriminated union of terminal | note). A new `useNotes` hook owns note pane state and persists a per-window note list to `~/.claude-cockpit/notes/windows/{label}.json`; a `useNoteContent` hook loads/saves each note's ProseMirror JSON to `~/.claude-cockpit/notes/content/{id}.json`. Notes deliberately live outside `WindowState` and the terminal recovery flow — they are durable documents, not at-risk live sessions.

**Tech Stack:** React 19, TypeScript, Tauri v2 (Rust), TipTap v3 (ProseMirror), Vitest (added by this plan).

**Spec:** `docs/superpowers/specs/2026-06-30-notes-canvas-pane-design.md`

## Global Constraints

- **TipTap pinned to v3** (currently `3.27.x`); it supports `react@^19`.
- **No raw markdown authoring** — only bullets and checkboxes via toolbar buttons and input rules (`*␣`, `[]␣`); never require typing `##`, `**`, etc.
- **Notes never touch `WindowState`, `useTerminals`, or the recovery modal.** They persist to their own files and reload immediately on launch.
- **Note content is ProseMirror JSON**, not a markdown string.
- **Filename safety:** every `label`/`id` used to build a note file path MUST pass the same `is_safe_label` check the workspace store uses (ascii alphanumerics, `-`, `_`, non-empty).
- **Typecheck floor:** `npm run build` (`tsc`) must pass. Rust: `cargo test` and `cargo build` must pass.
- **Frequent commits:** one commit per task minimum, following the existing message style.

---

## File Structure

**Created:**
- `vitest.config.ts` — Vitest config (jsdom, react plugin).
- `src/test/setup.ts` — test setup (jest-dom matchers).
- `src-tauri/src/notes/mod.rs` — notes domain module declaration.
- `src-tauri/src/notes/store.rs` — note file persistence + safety + tests.
- `src-tauri/src/commands/notes.rs` — Tauri command wrappers for the notes store.
- `src/types/pane.ts` — `NotePane`, `Pane`, `PersistedNote` types.
- `src/hooks/useNotes.ts` — note pane list state + per-window persistence.
- `src/hooks/useNotes.test.ts` — tests for the above.
- `src/hooks/useNoteContent.ts` — per-note content load/debounce-save/flush.
- `src/hooks/useNoteContent.test.ts` — tests for the above.
- `src/components/terminal/NoteCell.tsx` — note pane chrome (mirrors `TerminalCell`).
- `src/components/terminal/NoteEditor.tsx` — TipTap editor + toolbar.

**Modified:**
- `package.json` — add Vitest devDeps + `test` script; add TipTap deps.
- `src-tauri/src/lib.rs` — declare `notes` module, register the 6 new commands.
- `src-tauri/src/commands/mod.rs` — declare `pub mod notes;`.
- `src/lib/ipc.ts` — 6 new IPC wrappers.
- `src/components/terminal/TerminalGrid.tsx` — take `panes`; toolbar counts + New Note button.
- `src/components/terminal/TerminalCanvas.tsx` — take `panes`; render `TerminalCell` or `NoteCell`.
- `src/components/layout/WorkspaceBar.tsx` — show note count/glyph per tab.
- `src/App.tsx` — compose `useNotes`, merge panes per workspace, New Note button + Cmd+Shift+N, route close/rename by kind, workspace-delete note reassignment, discard wiring.

---

## Task 1: Bootstrap Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`, `src/test/setup.ts`, `src/test/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` runs Vitest with a jsdom environment and `@testing-library/react`; other frontend tasks rely on this runner existing.

- [ ] **Step 1: Install dev dependencies**

```bash
npm install -D vitest@^3 jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Add the `test` script to `package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Write a smoke test that proves the runner works**

Create `src/test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest bootstrap", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts src/test/smoke.test.ts
git commit -m "test: bootstrap vitest with jsdom + testing-library"
```

---

## Task 2: Backend notes store + commands

**Files:**
- Create: `src-tauri/src/notes/mod.rs`, `src-tauri/src/notes/store.rs`, `src-tauri/src/commands/notes.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`
- Test: inline `#[cfg(test)]` module in `store.rs`

**Interfaces:**
- Produces (Tauri commands, all `snake_case` invoked from JS):
  - `get_window_notes(label: String) -> Vec<PersistedNote>`
  - `save_window_notes(label: String, notes: Vec<PersistedNote>) -> ()`
  - `get_note_content(id: String) -> Option<serde_json::Value>`
  - `save_note_content(id: String, content: serde_json::Value) -> ()`
  - `remove_note_content(id: String) -> ()`
  - `clear_notes() -> ()`
  - `PersistedNote { id: String, label: String, color: String, workspace_id: Option<String> }`

- [ ] **Step 1: Write the store with a failing test module**

Create `src-tauri/src/notes/store.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// A persisted note pane: enough to recreate the window on next launch. The text
/// content lives separately (content file keyed by id), never here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedNote {
    pub id: String,
    pub label: String,
    pub color: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

fn base_dir() -> PathBuf {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude-cockpit")
        .join("notes");
    fs::create_dir_all(&dir).ok();
    dir
}

fn windows_dir() -> PathBuf {
    let dir = base_dir().join("windows");
    fs::create_dir_all(&dir).ok();
    dir
}

fn content_dir() -> PathBuf {
    let dir = base_dir().join("content");
    fs::create_dir_all(&dir).ok();
    dir
}

/// Filenames are derived from window labels and note ids, both cockpit-controlled.
/// Reject anything with path-escaping characters so a value can never leave the dir.
fn is_safe(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn window_file(label: &str) -> Option<PathBuf> {
    if !is_safe(label) {
        return None;
    }
    Some(windows_dir().join(format!("{label}.json")))
}

fn content_file(id: &str) -> Option<PathBuf> {
    if !is_safe(id) {
        return None;
    }
    Some(content_dir().join(format!("{id}.json")))
}

pub fn get_window_notes(label: &str) -> Vec<PersistedNote> {
    let Some(path) = window_file(label) else {
        return Vec::new();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_window_notes(
    label: &str,
    notes: &[PersistedNote],
) -> Result<(), crate::error::CockpitError> {
    let path = window_file(label)
        .ok_or_else(|| crate::error::CockpitError::InvalidInput("Bad window label".into()))?;
    fs::write(&path, serde_json::to_string_pretty(notes)?)?;
    Ok(())
}

pub fn get_note_content(id: &str) -> Option<serde_json::Value> {
    let path = content_file(id)?;
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn save_note_content(
    id: &str,
    content: &serde_json::Value,
) -> Result<(), crate::error::CockpitError> {
    let path = content_file(id)
        .ok_or_else(|| crate::error::CockpitError::InvalidInput("Bad note id".into()))?;
    fs::write(&path, serde_json::to_string_pretty(content)?)?;
    Ok(())
}

pub fn remove_note_content(id: &str) {
    if let Some(path) = content_file(id) {
        fs::remove_file(path).ok();
    }
}

/// Discard every note file (pane lists + content). Called on session discard.
pub fn clear_notes() -> Result<(), crate::error::CockpitError> {
    for dir in [windows_dir(), content_dir()] {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                fs::remove_file(entry.path()).ok();
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str) -> PersistedNote {
        PersistedNote {
            id: id.into(),
            label: "Note".into(),
            color: "#fff".into(),
            workspace_id: Some("ws-1".into()),
        }
    }

    #[test]
    fn rejects_unsafe_names() {
        assert!(!is_safe("../etc"));
        assert!(!is_safe("a/b"));
        assert!(!is_safe(""));
        assert!(is_safe("main"));
        assert!(is_safe("window-abc_123"));
        assert!(window_file("../escape").is_none());
        assert!(content_file("../escape").is_none());
    }

    #[test]
    fn window_notes_round_trip() {
        let label = "test-window-roundtrip";
        let notes = vec![note("n-1"), note("n-2")];
        save_window_notes(label, &notes).unwrap();
        assert_eq!(get_window_notes(label), notes);
        // cleanup
        fs::remove_file(window_file(label).unwrap()).ok();
    }

    #[test]
    fn content_write_read_remove() {
        let id = "test-note-content";
        let content = serde_json::json!({ "type": "doc", "content": [] });
        save_note_content(id, &content).unwrap();
        assert_eq!(get_note_content(id), Some(content));
        remove_note_content(id);
        assert_eq!(get_note_content(id), None);
    }

    #[test]
    fn missing_files_are_empty() {
        assert_eq!(get_window_notes("test-nonexistent-window"), Vec::new());
        assert_eq!(get_note_content("test-nonexistent-note"), None);
    }
}
```

- [ ] **Step 2: Create the module declaration**

Create `src-tauri/src/notes/mod.rs`:

```rust
pub mod store;
```

- [ ] **Step 3: Register the module in `lib.rs`**

In `src-tauri/src/lib.rs`, add to the top module declarations (alphabetically, after `background`):

```rust
pub mod notes;
```

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `cd src-tauri && cargo test notes::store`
Expected: PASS, 4 tests (`rejects_unsafe_names`, `window_notes_round_trip`, `content_write_read_remove`, `missing_files_are_empty`).

- [ ] **Step 5: Create the command wrappers**

Create `src-tauri/src/commands/notes.rs`:

```rust
use crate::error::CockpitError;
use crate::notes::store::{self, PersistedNote};

#[tauri::command]
pub fn get_window_notes(label: String) -> Result<Vec<PersistedNote>, CockpitError> {
    Ok(store::get_window_notes(&label))
}

#[tauri::command]
pub fn save_window_notes(label: String, notes: Vec<PersistedNote>) -> Result<(), CockpitError> {
    store::save_window_notes(&label, &notes)
}

#[tauri::command]
pub fn get_note_content(id: String) -> Result<Option<serde_json::Value>, CockpitError> {
    Ok(store::get_note_content(&id))
}

#[tauri::command]
pub fn save_note_content(id: String, content: serde_json::Value) -> Result<(), CockpitError> {
    store::save_note_content(&id, &content)
}

#[tauri::command]
pub fn remove_note_content(id: String) -> Result<(), CockpitError> {
    store::remove_note_content(&id);
    Ok(())
}

#[tauri::command]
pub fn clear_notes() -> Result<(), CockpitError> {
    store::clear_notes()
}
```

- [ ] **Step 6: Declare the commands module**

In `src-tauri/src/commands/mod.rs`, add:

```rust
pub mod notes;
```

- [ ] **Step 7: Register the commands in the invoke handler**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![ ... ]`, add after the `commands::workspace::*` block:

```rust
            commands::notes::get_window_notes,
            commands::notes::save_window_notes,
            commands::notes::get_note_content,
            commands::notes::save_note_content,
            commands::notes::remove_note_content,
            commands::notes::clear_notes,
```

- [ ] **Step 8: Build to verify the backend compiles**

Run: `cd src-tauri && cargo build`
Expected: compiles with no errors.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/notes src-tauri/src/commands/notes.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(notes): backend note store + tauri commands"
```

---

## Task 3: Frontend types + IPC wrappers

**Files:**
- Create: `src/types/pane.ts`
- Modify: `src/lib/ipc.ts`

**Interfaces:**
- Consumes: the 6 Tauri commands from Task 2.
- Produces:
  - `PersistedNote { id; label; color; workspace_id: string | null }`
  - `NotePane { id; label; color; workspaceId: string }`
  - `Pane = ({ kind: "terminal" } & TerminalInfo) | ({ kind: "note" } & NotePane)`
  - IPC: `getWindowNotes`, `saveWindowNotes`, `getNoteContent`, `saveNoteContent`, `removeNoteContent`, `clearNotes`.

- [ ] **Step 1: Create the pane types**

Create `src/types/pane.ts`:

```ts
import type { TerminalInfo } from "./terminal";

/** A note pane's runtime state (content lives in its own file, keyed by id). */
export interface NotePane {
  id: string;
  label: string;
  color: string;
  workspaceId: string;
}

/** The persisted note-pane shape written to notes/windows/{label}.json. */
export interface PersistedNote {
  id: string;
  label: string;
  color: string;
  workspace_id: string | null;
}

/** A pane on the canvas: either a live terminal or a note. */
export type Pane =
  | ({ kind: "terminal" } & TerminalInfo)
  | ({ kind: "note" } & NotePane);
```

- [ ] **Step 2: Add the IPC wrappers**

In `src/lib/ipc.ts`, add a `PersistedNote` import to the existing type import block from `../types/...` (add `import type { NotePane, PersistedNote } from "../types/pane";` near the other type imports), then append after the `clearSession` export (around line 94):

```ts
// Notes commands
export const getWindowNotes = (label: string) =>
  invoke<PersistedNote[]>("get_window_notes", { label });

export const saveWindowNotes = (label: string, notes: PersistedNote[]) =>
  invoke<void>("save_window_notes", { label, notes });

export const getNoteContent = (id: string) =>
  invoke<unknown | null>("get_note_content", { id });

export const saveNoteContent = (id: string, content: unknown) =>
  invoke<void>("save_note_content", { id, content });

export const removeNoteContent = (id: string) =>
  invoke<void>("remove_note_content", { id });

export const clearNotes = () => invoke<void>("clear_notes");
```

(The `NotePane` import is used by later tasks importing from `ipc` consumers; if `tsc` flags it as unused here, drop it — keep only `PersistedNote`.)

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: `tsc` passes, `vite build` completes.

- [ ] **Step 4: Commit**

```bash
git add src/types/pane.ts src/lib/ipc.ts
git commit -m "feat(notes): pane types + note IPC wrappers"
```

---

## Task 4: `useNotes` hook (pane list + persistence)

**Files:**
- Create: `src/hooks/useNotes.ts`, `src/hooks/useNotes.test.ts`

**Interfaces:**
- Consumes: `getWindowNotes`, `saveWindowNotes`, `removeNoteContent`, `clearNotes` from `../lib/ipc`; `generateId` from `../lib/utils`; `PROJECT_COLORS` from `../lib/constants`; `getCurrentWindow().label`.
- Produces the hook return:
  ```ts
  {
    notes: NotePane[];
    addNote: (workspaceId: string) => NotePane;
    renameNote: (id: string, label: string) => void;
    removeNote: (id: string) => void;
    reassignNotes: (fromWorkspaceId: string, toWorkspaceId: string) => void;
    discardNotes: () => Promise<void>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useNotes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Mock the Tauri window label + ipc before importing the hook.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

const ipc = vi.hoisted(() => ({
  getWindowNotes: vi.fn(async () => [] as any[]),
  saveWindowNotes: vi.fn(async () => {}),
  removeNoteContent: vi.fn(async () => {}),
  clearNotes: vi.fn(async () => {}),
}));
vi.mock("../lib/ipc", () => ipc);

import { useNotes } from "./useNotes";

beforeEach(() => {
  vi.clearAllMocks();
  ipc.getWindowNotes.mockResolvedValue([]);
});

describe("useNotes", () => {
  it("adds a note into the given workspace", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addNote("ws-1");
    });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].workspaceId).toBe("ws-1");
  });

  it("renames and removes notes", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addNote("ws-1").id;
    });
    act(() => result.current.renameNote(id, "Groceries"));
    expect(result.current.notes[0].label).toBe("Groceries");

    act(() => result.current.removeNote(id));
    expect(result.current.notes).toHaveLength(0);
    expect(ipc.removeNoteContent).toHaveBeenCalledWith(id);
  });

  it("reassigns notes from a deleted workspace to a fallback", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addNote("ws-doomed");
    });
    act(() => result.current.reassignNotes("ws-doomed", "ws-keep"));
    expect(result.current.notes[0].workspaceId).toBe("ws-keep");
  });

  it("restores notes loaded from disk", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
    ]);
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.notes[0]).toEqual({
      id: "n-1",
      label: "Todo",
      color: "#abc",
      workspaceId: "ws-9",
    });
  });

  it("does not persist before the initial load completes", async () => {
    let resolveLoad: (v: any[]) => void = () => {};
    ipc.getWindowNotes.mockReturnValue(
      new Promise((r) => (resolveLoad = r)) as any
    );
    renderHook(() => useNotes());
    // Load hasn't resolved yet — the save effect must not have fired.
    expect(ipc.saveWindowNotes).not.toHaveBeenCalled();
    await act(async () => resolveLoad([]));
  });

  it("discardNotes clears state and files", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
    ]);
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    await act(async () => {
      await result.current.discardNotes();
    });
    expect(result.current.notes).toHaveLength(0);
    expect(ipc.clearNotes).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useNotes`
Expected: FAIL — cannot find module `./useNotes`.

- [ ] **Step 3: Implement `useNotes`**

Create `src/hooks/useNotes.ts`:

```ts
import { useState, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getWindowNotes,
  saveWindowNotes,
  removeNoteContent,
  clearNotes,
} from "../lib/ipc";
import { generateId } from "../lib/utils";
import { PROJECT_COLORS } from "../lib/constants";
import type { NotePane, PersistedNote } from "../types/pane";

const WINDOW_LABEL = getCurrentWindow().label;

function toPersisted(n: NotePane): PersistedNote {
  return {
    id: n.id,
    label: n.label,
    color: n.color,
    workspace_id: n.workspaceId,
  };
}

function fromPersisted(n: PersistedNote): NotePane {
  return {
    id: n.id,
    label: n.label,
    color: n.color,
    workspaceId: n.workspace_id ?? "",
  };
}

/**
 * Owns the note panes for this window and persists them to their own per-window
 * file. Deliberately independent of `useTerminals` / `WindowState` / the recovery
 * modal: notes are durable documents, so they load immediately on launch and are
 * never gated behind a Recover/Discard choice.
 */
export function useNotes() {
  const [notes, setNotes] = useState<NotePane[]>([]);
  // Disarm persistence until the initial load completes, so the empty initial
  // state can't overwrite the saved file.
  const [loaded, setLoaded] = useState(false);

  const addNote = useCallback((workspaceId: string): NotePane => {
    const note: NotePane = {
      id: generateId(),
      label: "Note",
      color: PROJECT_COLORS[Math.floor(Date.now()) % PROJECT_COLORS.length],
      workspaceId,
    };
    setNotes((prev) => [...prev, note]);
    return note;
  }, []);

  const renameNote = useCallback((id: string, label: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, label } : n)));
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    removeNoteContent(id).catch((e) =>
      console.error("Failed to remove note content:", e)
    );
  }, []);

  const reassignNotes = useCallback(
    (fromWorkspaceId: string, toWorkspaceId: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.workspaceId === fromWorkspaceId
            ? { ...n, workspaceId: toWorkspaceId }
            : n
        )
      );
    },
    []
  );

  const discardNotes = useCallback(async () => {
    setNotes([]);
    await clearNotes().catch((e) =>
      console.error("Failed to clear notes:", e)
    );
  }, []);

  // Load this window's saved notes on mount, then arm persistence.
  useEffect(() => {
    (async () => {
      try {
        const persisted = await getWindowNotes(WINDOW_LABEL);
        setNotes(persisted.map(fromPersisted));
      } catch (error) {
        console.error("Failed to load notes:", error);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Persist whenever notes change, once armed.
  useEffect(() => {
    if (!loaded) return;
    saveWindowNotes(WINDOW_LABEL, notes.map(toPersisted)).catch((e) =>
      console.error("Failed to persist notes:", e)
    );
  }, [notes, loaded]);

  return { notes, addNote, renameNote, removeNote, reassignNotes, discardNotes };
}
```

Note on `addNote` color: `Date.now()` is only a color spread; if the lint/test environment forbids it, replace with `PROJECT_COLORS[0]`. The test does not assert color.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- useNotes`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNotes.ts src/hooks/useNotes.test.ts
git commit -m "feat(notes): useNotes hook with per-window persistence"
```

---

## Task 5: `useNoteContent` hook (debounced content save)

**Files:**
- Create: `src/hooks/useNoteContent.ts`, `src/hooks/useNoteContent.test.ts`

**Interfaces:**
- Consumes: `getNoteContent`, `saveNoteContent` from `../lib/ipc`.
- Produces:
  ```ts
  useNoteContent(id: string): {
    loaded: boolean;
    initialContent: unknown | null;   // ProseMirror JSON, or null for empty
    onChange: (content: unknown) => void;  // schedules debounced save
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useNoteContent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const ipc = vi.hoisted(() => ({
  getNoteContent: vi.fn(async () => null as unknown),
  saveNoteContent: vi.fn(async () => {}),
}));
vi.mock("../lib/ipc", () => ipc);

import { useNoteContent } from "./useNoteContent";

beforeEach(() => {
  vi.clearAllMocks();
  ipc.getNoteContent.mockResolvedValue(null);
});

describe("useNoteContent", () => {
  it("loads initial content for the id", async () => {
    const doc = { type: "doc", content: [] };
    ipc.getNoteContent.mockResolvedValue(doc);
    const { result } = renderHook(() => useNoteContent("n-1"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(ipc.getNoteContent).toHaveBeenCalledWith("n-1");
    expect(result.current.initialContent).toEqual(doc);
  });

  it("coalesces rapid edits into a single debounced save", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNoteContent("n-1"));
    await vi.runOnlyPendingTimersAsync(); // let load resolve

    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    act(() => result.current.onChange({ v: 3 }));
    expect(ipc.saveNoteContent).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(ipc.saveNoteContent).toHaveBeenCalledTimes(1);
    expect(ipc.saveNoteContent).toHaveBeenCalledWith("n-1", { v: 3 });
    vi.useRealTimers();
  });

  it("flushes a pending save on unmount", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useNoteContent("n-1"));
    await vi.runOnlyPendingTimersAsync();

    act(() => result.current.onChange({ v: 42 }));
    unmount();
    expect(ipc.saveNoteContent).toHaveBeenCalledWith("n-1", { v: 42 });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useNoteContent`
Expected: FAIL — cannot find module `./useNoteContent`.

- [ ] **Step 3: Implement `useNoteContent`**

Create `src/hooks/useNoteContent.ts`:

```ts
import { useState, useEffect, useRef, useCallback } from "react";
import { getNoteContent, saveNoteContent } from "../lib/ipc";

const SAVE_DEBOUNCE_MS = 500;

/**
 * Loads a note's ProseMirror JSON on mount and saves edits back, debounced.
 * Any pending save is flushed on unmount so no keystrokes are lost. Kept separate
 * from the editor component so the debounce/flush logic is testable in isolation.
 */
export function useNoteContent(id: string) {
  const [loaded, setLoaded] = useState(false);
  const [initialContent, setInitialContent] = useState<unknown | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<unknown | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (pendingRef.current !== null) {
      const content = pendingRef.current;
      pendingRef.current = null;
      saveNoteContent(id, content).catch((e) =>
        console.error("Failed to save note content:", e)
      );
    }
  }, [id]);

  const onChange = useCallback(
    (content: unknown) => {
      pendingRef.current = content;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  useEffect(() => {
    (async () => {
      try {
        const content = await getNoteContent(id);
        setInitialContent(content ?? null);
      } catch (error) {
        console.error("Failed to load note content:", error);
      } finally {
        setLoaded(true);
      }
    })();
    // Flush any pending save when the pane unmounts.
    return () => flush();
  }, [id, flush]);

  return { loaded, initialContent, onChange };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- useNoteContent`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNoteContent.ts src/hooks/useNoteContent.test.ts
git commit -m "feat(notes): useNoteContent debounced content persistence"
```

---

## Task 6: NoteEditor + NoteCell components

**Files:**
- Modify: `package.json`
- Create: `src/components/terminal/NoteEditor.tsx`, `src/components/terminal/NoteCell.tsx`

**Interfaces:**
- Consumes: `useNoteContent` (Task 5); `NotePane` type.
- Produces:
  - `NoteEditor({ initialContent, onChange }: { initialContent: unknown | null; onChange: (doc: unknown) => void })`
  - `NoteCell({ note, isActive, onSelect, onClose, onRename, onHeaderPointerDown })` with the same prop shape `TerminalCell` uses for `isActive/onSelect/onClose/onRename/onHeaderPointerDown`, plus `note: NotePane`.

- [ ] **Step 1: Install TipTap v3**

```bash
npm install @tiptap/react@^3 @tiptap/starter-kit@^3 @tiptap/extension-task-list@^3 @tiptap/extension-task-item@^3
```

Verify the installed versions are `3.x`:

```bash
npm ls @tiptap/react @tiptap/starter-kit @tiptap/extension-task-list @tiptap/extension-task-item
```

Expected: all resolve to a `3.x` version. If `extension-task-list`/`extension-task-item` are reported as already bundled in StarterKit v3, remove the redundant installs and import `TaskList`/`TaskItem` from `@tiptap/starter-kit` instead — adjust the imports in Step 2 accordingly.

- [ ] **Step 2: Create `NoteEditor.tsx`**

```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { ListTodo, List, Undo2, Redo2 } from "lucide-react";
import type { Editor } from "@tiptap/react";

interface NoteEditorProps {
  initialContent: unknown | null;
  onChange: (doc: unknown) => void;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep editor focus/selection
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? "text-accent-cyan bg-accent-cyan/15"
          : "text-foreground-muted hover:text-foreground hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-card-border bg-background-secondary/20">
      <ToolbarButton
        title="Checklist"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </ToolbarButton>
      <div className="w-px h-4 bg-card-border mx-1" />
      <ToolbarButton
        title="Undo"
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Redo"
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={14} />
      </ToolbarButton>
    </div>
  );
}

/**
 * A lightweight WYSIWYG note editor. Bullets (`*␣`/`-␣`) and checkboxes (`[]␣`)
 * come from TipTap input rules; Enter continues a list and exits it on an empty
 * item. No raw markdown syntax is required from the user.
 */
export function NoteEditor({ initialContent, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: (initialContent as any) ?? "",
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: {
        class:
          "note-prose flex-1 min-h-0 overflow-auto px-3 py-2 text-sm text-foreground outline-none",
      },
    },
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {editor && <Toolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className="flex-1 min-h-0 overflow-auto"
      />
    </div>
  );
}
```

- [ ] **Step 3: Add editor styles**

Append to `src/styles/` main stylesheet (the file imported by `main.tsx` — confirm with `grep -rl "@tailwind\|tailwind" src/styles src/main.tsx`). Add checkbox layout so task items render inline with their checkbox:

```css
/* Note editor (TipTap) */
.note-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.note-prose ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
.note-prose ul[data-type="taskList"] li > label { margin-top: 0.15rem; }
.note-prose ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; opacity: 0.6; }
.note-prose ul:not([data-type="taskList"]) { list-style: disc; padding-left: 1.25rem; }
.note-prose p { margin: 0.15rem 0; }
```

- [ ] **Step 4: Create `NoteCell.tsx`**

```tsx
import { useState, useCallback } from "react";
import type React from "react";
import { X, Pencil, Check, StickyNote } from "lucide-react";
import { NoteEditor } from "./NoteEditor";
import { useNoteContent } from "../../hooks/useNoteContent";
import type { NotePane } from "../../types/pane";

interface NoteCellProps {
  note: NotePane;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
}

export function NoteCell({
  note,
  isActive,
  onSelect,
  onClose,
  onRename,
  onHeaderPointerDown,
}: NoteCellProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(note.label);
  const { loaded, initialContent, onChange } = useNoteContent(note.id);

  const handleSubmitRename = useCallback(() => {
    if (editName.trim()) onRename(editName.trim());
    setEditing(false);
  }, [editName, onRename]);

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
    >
      {/* Cell header */}
      <div
        onPointerDown={onHeaderPointerDown}
        className={`flex items-center gap-2 px-2 py-1 border-b select-none backdrop-blur-md ${
          onHeaderPointerDown && !editing
            ? "cursor-grab active:cursor-grabbing"
            : ""
        } ${
          isActive
            ? "border-accent-cyan/30 bg-accent-cyan/5"
            : "border-card-border bg-background-secondary/30"
        }`}
      >
        <StickyNote
          size={12}
          className="flex-shrink-0"
          style={{ color: isActive ? note.color : undefined }}
        />

        {editing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmitRename();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={handleSubmitRename}
              className="bg-white/5 border border-card-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent-cyan w-full"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSubmitRename();
              }}
              className="p-0.5 rounded hover:bg-white/10 text-accent-cyan flex-shrink-0"
            >
              <Check size={12} />
            </button>
          </div>
        ) : (
          <>
            <span
              className="text-xs font-medium truncate flex-1"
              style={{ color: isActive ? note.color : undefined }}
            >
              {note.label}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditName(note.label);
                setEditing(true);
              }}
              className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
              <Pencil size={10} />
            </button>
          </>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="p-0.5 rounded hover:bg-red-500/20 text-foreground-muted hover:text-red-400 flex-shrink-0"
        >
          <X size={12} />
        </button>
      </div>

      {/* Editor (mounted only once content has loaded, so TipTap initializes
          with the saved doc rather than an empty one then replacing it). */}
      <div className="flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
        {loaded ? (
          <NoteEditor initialContent={initialContent} onChange={onChange} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-foreground-muted">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck / build**

Run: `npm run build`
Expected: `tsc` + `vite build` pass. (This confirms TipTap imports resolve under React 19.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/terminal/NoteEditor.tsx src/components/terminal/NoteCell.tsx src/styles
git commit -m "feat(notes): TipTap note editor + NoteCell pane"
```

---

## Task 7: Generalize the canvas to panes

**Files:**
- Modify: `src/components/terminal/TerminalCanvas.tsx`, `src/components/terminal/TerminalGrid.tsx`

**Interfaces:**
- Consumes: `Pane` type; `NoteCell` (Task 6); existing `TerminalCell`.
- Produces the new `TerminalGrid` / `TerminalCanvas` prop shape:
  ```ts
  panes: Pane[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClosePane: (id: string) => void;          // App routes kill vs note delete
  onRenamePane: (id: string, label: string) => void; // App routes to terminal/note rename
  onSessionRename: (id: string, sessionName: string) => void; // terminals only
  onStatusChange: (id: string, status: TerminalStatus) => void; // terminals only
  onExit: (id: string, code: number | null) => void;            // terminals only
  onNewTerminal: () => void;
  onNewNote: () => void;
  ```

- [ ] **Step 1: Rewrite `TerminalCanvas.tsx` to render panes**

Replace the prop interface and the `terminals.map(...)` body. Change the props block (lines 7-20) to:

```tsx
import { useMemo, useRef } from "react";
import type React from "react";
import { TerminalCell } from "./TerminalCell";
import { NoteCell } from "./NoteCell";
import { MIN_W, MIN_H, type Rect } from "../../hooks/useCanvasLayout";
import type { Pane } from "../../types/pane";
import type { TerminalStatus } from "../../types/terminal";

interface TerminalCanvasProps {
  panes: Pane[];
  activeId: string | null;
  layout: Record<string, Rect>;
  setRect: (id: string, rect: Rect) => void;
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void;
  onClosePane: (id: string) => void;
  onRenamePane: (id: string, label: string) => void;
  onSessionRename: (id: string, sessionName: string) => void;
  onStatusChange: (id: string, status: TerminalStatus) => void;
  onExit: (id: string, code: number | null) => void;
}
```

Update the destructure and the `ids`/`extent` memos to use `panes` instead of `terminals`:

```tsx
export function TerminalCanvas({
  panes,
  activeId,
  layout,
  setRect,
  surfaceRef,
  onSelect,
  onClosePane,
  onRenamePane,
  onSessionRename,
  onStatusChange,
  onExit,
}: TerminalCanvasProps) {
  const ids = useMemo(() => panes.map((p) => p.id), [panes]);
```

Then replace the `{terminals.map((terminal) => { ... })}` block (the inner render of each window) with a pane-kind switch. The wrapping `<div>` (position/zIndex) and the resize handle stay identical — only the cell inside changes:

```tsx
        {panes.map((pane) => {
          const rect = layout[pane.id];
          if (!rect) return null;
          const isActive = pane.id === activeId;
          const headerPointerDown = (e: React.PointerEvent) => {
            if ((e.target as HTMLElement).closest("button, input")) return;
            onSelect(pane.id);
            startGesture(e, pane.id, "move");
          };
          return (
            <div
              key={pane.id}
              className={`absolute rounded-lg overflow-hidden terminal-window ${
                isActive ? "is-active" : ""
              }`}
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                zIndex: isActive ? 20 : 10,
              }}
            >
              {pane.kind === "terminal" ? (
                <TerminalCell
                  terminal={pane}
                  isActive={isActive}
                  onSelect={() => onSelect(pane.id)}
                  onClose={() => onClosePane(pane.id)}
                  onRename={(label) => onRenamePane(pane.id, label)}
                  onSessionRename={(name) => onSessionRename(pane.id, name)}
                  onStatusChange={(status) => onStatusChange(pane.id, status)}
                  onExit={(code) => onExit(pane.id, code)}
                  onHeaderPointerDown={headerPointerDown}
                />
              ) : (
                <NoteCell
                  note={pane}
                  isActive={isActive}
                  onSelect={() => onSelect(pane.id)}
                  onClose={() => onClosePane(pane.id)}
                  onRename={(label) => onRenamePane(pane.id, label)}
                  onHeaderPointerDown={headerPointerDown}
                />
              )}
              {/* Resize handle (bottom-right corner). */}
              <div
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(pane.id);
                  startGesture(e, pane.id, "resize");
                }}
                className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30"
                title="Drag to resize"
                style={{
                  background:
                    "linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.5) 50%)",
                }}
              />
            </div>
          );
        })}
```

`startGesture`, `gestureRef`, and the `extent` memo (change `terminals`→`panes` where it iterates ids) are otherwise unchanged.

- [ ] **Step 2: Rewrite `TerminalGrid.tsx` to take panes**

Change the props interface and destructure:

```tsx
import { useMemo, useRef, useCallback } from "react";
import { Plus, LayoutGrid, StickyNote } from "lucide-react";
import { TerminalCanvas } from "./TerminalCanvas";
import { useCanvasLayout, tileRects } from "../../hooks/useCanvasLayout";
import type { Pane } from "../../types/pane";
import type { TerminalStatus } from "../../types/terminal";

interface TerminalGridProps {
  panes: Pane[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClosePane: (id: string) => void;
  onRenamePane: (id: string, label: string) => void;
  onSessionRename: (id: string, sessionName: string) => void;
  onStatusChange: (id: string, status: TerminalStatus) => void;
  onExit: (id: string, code: number | null) => void;
  onNewTerminal: () => void;
  onNewNote: () => void;
}
```

Update the body: `ids` from panes, counts split by kind, empty-state offers both, and add a New Note button.

```tsx
export function TerminalGrid({
  panes,
  activeId,
  onSelect,
  onClosePane,
  onRenamePane,
  onSessionRename,
  onStatusChange,
  onExit,
  onNewTerminal,
  onNewNote,
}: TerminalGridProps) {
  const ids = useMemo(() => panes.map((p) => p.id), [panes]);
  const { layout, setRect, setAll } = useCanvasLayout(ids);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const termCount = panes.filter((p) => p.kind === "terminal").length;
  const noteCount = panes.filter((p) => p.kind === "note").length;

  const arrange = useCallback(
    (cols: number) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const w = surface.clientWidth;
      const h = surface.clientHeight;
      if (w === 0 || h === 0) return;
      setAll(tileRects(ids, cols, w, h));
    },
    [ids, setAll]
  );

  if (panes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-foreground-muted text-lg">Nothing open</p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={onNewTerminal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30 font-medium text-sm"
            >
              <Plus size={16} />
              New Terminal
            </button>
            <button
              onClick={onNewNote}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-foreground-muted hover:text-foreground hover:bg-white/10 font-medium text-sm"
            >
              <StickyNote size={16} />
              New Note
            </button>
          </div>
        </div>
      </div>
    );
  }

  const colButtonClass =
    "w-7 h-7 rounded-md text-xs font-semibold text-foreground-muted hover:text-foreground hover:bg-white/5 transition-colors";

  const countLabel =
    [
      termCount > 0 ? `${termCount} terminal${termCount !== 1 ? "s" : ""}` : "",
      noteCount > 0 ? `${noteCount} note${noteCount !== 1 ? "s" : ""}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Empty";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-background-secondary/20 backdrop-blur-xl border-b border-white/10">
        <span className="text-xs text-foreground-muted">{countLabel}</span>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-foreground-muted/60 mr-1">
            Arrange
          </span>
          <button
            onClick={() => arrange(0)}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5 transition-colors"
            title="Tidy up (auto grid)"
          >
            <LayoutGrid size={14} />
          </button>
          {[1, 2, 3].map((cols) => (
            <button
              key={cols}
              onClick={() => arrange(cols)}
              className={colButtonClass}
              title={`Arrange in ${cols} column${cols > 1 ? "s" : ""}`}
            >
              {cols}
            </button>
          ))}

          <div className="w-px h-4 bg-card-border mx-1" />

          <button
            onClick={onNewNote}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
            title="New note (Cmd+Shift+N)"
          >
            <StickyNote size={14} />
          </button>
          <button
            onClick={onNewTerminal}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
            title="New terminal (Cmd+T)"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <TerminalCanvas
        panes={panes}
        activeId={activeId}
        layout={layout}
        setRect={setRect}
        surfaceRef={surfaceRef}
        onSelect={onSelect}
        onClosePane={onClosePane}
        onRenamePane={onRenamePane}
        onSessionRename={onSessionRename}
        onStatusChange={onStatusChange}
        onExit={onExit}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: `tsc` reports errors ONLY in `src/App.tsx` (it still passes `terminals=` to `TerminalGrid`). That is expected — Task 8 fixes App. `TerminalGrid.tsx`/`TerminalCanvas.tsx` themselves must be error-free.

To confirm the two files are internally consistent, run just their typecheck via the whole build and verify the only errors reference `App.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/terminal/TerminalGrid.tsx src/components/terminal/TerminalCanvas.tsx
git commit -m "refactor(canvas): render a list of panes (terminal | note)"
```

---

## Task 8: App wiring + workspace-bar note counts

**Files:**
- Modify: `src/App.tsx`, `src/components/layout/WorkspaceBar.tsx`

**Interfaces:**
- Consumes: `useNotes` (Task 4); the new `TerminalGrid` pane props (Task 7); `Pane` type.
- Produces: fully wired notes — creation (button + Cmd+Shift+N), per-workspace pane composition, close/rename routing by kind, workspace-delete note reassignment, discard clearing notes, and note counts in the workspace bar.

- [ ] **Step 1: Add the `useNotes` hook and note-count map in `App.tsx`**

Add the import near the other hook imports:

```tsx
import { useNotes } from "./hooks/useNotes";
import type { Pane } from "./types/pane";
```

After the `useTerminals()` destructure block, add:

```tsx
  const {
    notes,
    addNote,
    renameNote,
    removeNote,
    reassignNotes,
    discardNotes,
  } = useNotes();
```

- [ ] **Step 2: Add a New Note handler and Cmd+Shift+N shortcut**

Add the handler next to `handleNewTerminal`:

```tsx
  const handleNewNote = useCallback(
    (workspaceId?: string) => {
      const note = addNote(workspaceId ?? activeWorkspaceId);
      setActiveId(note.id);
      play("launch");
    },
    [addNote, activeWorkspaceId, setActiveId, play]
  );
```

In the keyboard-shortcut `handleKeyDown` (inside the `if (e.metaKey || e.ctrlKey)` block), add a branch BEFORE the `e.key === "t"` branch so Shift+N is caught (note: with Shift held, `e.key` is `"n"`):

```tsx
        if (e.key === "n" && e.shiftKey) {
          e.preventDefault();
          handleNewNote();
          return;
        }
```

Add `handleNewNote` to the `handleKeyDown` effect dependency array.

- [ ] **Step 3: Route Cmd+W and pane close/rename by kind**

The `e.key === "w"` branch currently calls `kill(activeId)`. Replace it so it closes whichever pane is active:

```tsx
        } else if (e.key === "w") {
          e.preventDefault();
          if (activeId) closePane(activeId);
```

Add a `closePane` and `renamePane` helper (above the return), which route by pane kind and apply the note close-confirm:

```tsx
  const closePane = useCallback(
    (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (note) {
        if (
          window.confirm(
            `Delete note "${note.label}"? Its contents will be permanently removed.`
          )
        ) {
          removeNote(id);
          if (activeId === id) setActiveId(null);
          play("click");
        }
        return;
      }
      kill(id);
    },
    [notes, removeNote, kill, activeId, setActiveId, play]
  );

  const renamePane = useCallback(
    (id: string, label: string) => {
      if (notes.some((n) => n.id === id)) renameNote(id, label);
      else rename(id, label);
    },
    [notes, renameNote, rename]
  );
```

Add `closePane` to the `handleKeyDown` effect deps.

- [ ] **Step 4: Compose panes per workspace and update the render**

Replace the per-workspace render block (currently building `wsTerminals` and passing `terminals={wsTerminals}` to `TerminalGrid`) with one that merges terminals and notes into a `Pane[]`:

```tsx
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              const wsPanes: Pane[] = [
                ...terminals
                  .filter((t) => t.workspaceId === ws.id)
                  .map((t) => ({ kind: "terminal" as const, ...t })),
                ...notes
                  .filter((n) => n.workspaceId === ws.id)
                  .map((n) => ({ kind: "note" as const, ...n })),
              ];
              return (
                <div
                  key={ws.id}
                  className="absolute inset-0 flex flex-col"
                  style={{
                    visibility: isActive ? "visible" : "hidden",
                    zIndex: isActive ? 1 : 0,
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                >
                  <TerminalGrid
                    panes={wsPanes}
                    activeId={activeId}
                    onSelect={setActiveId}
                    onClosePane={closePane}
                    onRenamePane={renamePane}
                    onSessionRename={handleSessionRename}
                    onStatusChange={handleStatusChange}
                    onExit={handleExit}
                    onNewTerminal={() => handleNewTerminal(ws.id)}
                    onNewNote={() => handleNewNote(ws.id)}
                  />
                </div>
              );
            })}
```

- [ ] **Step 5: Wire discard + workspace-delete reassignment**

The `RestoreModal` `onDiscard={discard}` must also clear notes. Replace with a combined handler defined above the return:

```tsx
  const handleDiscard = useCallback(async () => {
    await Promise.all([discard(), discardNotes()]);
  }, [discard, discardNotes]);
```

and use `onDiscard={handleDiscard}`.

For workspace deletion, wrap `deleteWorkspace` so notes in the deleted workspace move to the same fallback `useTerminals` uses (`remaining[0]`):

```tsx
  const handleDeleteWorkspace = useCallback(
    (id: string) => {
      const remaining = workspaces.filter((w) => w.id !== id);
      if (remaining.length === 0) return; // mirror deleteWorkspace's guard
      reassignNotes(id, remaining[0].id);
      deleteWorkspace(id);
    },
    [workspaces, reassignNotes, deleteWorkspace]
  );
```

Pass `onDelete={handleDeleteWorkspace}` to `<WorkspaceBar>` (replacing `onDelete={deleteWorkspace}`).

- [ ] **Step 6: Add note counts to the workspace bar**

Compute a note-count map alongside `workspaceCounts`:

```tsx
  const workspaceNoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notes) {
      counts[n.workspaceId] = (counts[n.workspaceId] ?? 0) + 1;
    }
    return counts;
  }, [notes]);
```

Pass it to `<WorkspaceBar noteCounts={workspaceNoteCounts} ... />`.

Then in `src/components/layout/WorkspaceBar.tsx`: add `noteCounts` to the props interface and destructure, import `StickyNote` from `lucide-react`, and render a note badge next to the terminal count. Locate the block that renders `count` (around line 78-85) and add, right after it:

```tsx
            {(noteCounts[ws.id] ?? 0) > 0 && (
              <span
                className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-foreground-muted"
                title={`${noteCounts[ws.id]} note${noteCounts[ws.id] !== 1 ? "s" : ""}`}
              >
                <StickyNote size={9} />
                {noteCounts[ws.id]}
              </span>
            )}
```

Add to the props interface:

```tsx
  noteCounts: Record<string, number>;
```

- [ ] **Step 7: Typecheck / build**

Run: `npm run build`
Expected: `tsc` + `vite build` pass with no errors.

- [ ] **Step 8: Run the full frontend test suite**

Run: `npm test`
Expected: all tests pass (`useNotes`, `useNoteContent`, smoke).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/layout/WorkspaceBar.tsx
git commit -m "feat(notes): wire note panes into App + workspace bar"
```

---

## Task 9: Manual verification

**Files:** none (verification only).

> **IMPORTANT (project rule):** Do not build or launch a long-running dev server unprompted — the user runs this app live. Ask the user to run these checks, or run them only with explicit confirmation. See memory `no-rebuild-while-in-use`.

- [ ] **Step 1: Verify checklist (hand to the user)**

Confirm each:
1. Cmd+Shift+N (and the toolbar sticky-note button) creates a note pane on the canvas.
2. Toolbar checkbox button inserts a checkable item; clicking the box toggles strikethrough.
3. Typing `*␣` starts a bullet; `[]␣` starts a checkbox; Enter continues the list; Enter on an empty item exits it.
4. Type text, close and reopen the app (or the window) → note reappears with its text and checkbox states intact (notes reload without touching the Recover/Discard prompt).
5. Close a note → confirm dialog appears; on confirm the pane and its content file are gone.
6. Notes are draggable/resizable and honor the Arrange buttons alongside terminals.
7. A workspace containing only notes shows the note count in its tab.
8. Deleting a workspace with notes moves them to the first remaining workspace (they don't vanish).
9. Recover/Discard on relaunch: Discard clears notes too; Recover leaves notes present.

- [ ] **Step 2: Merge**

Once verified, use `superpowers:finishing-a-development-branch` to merge `feat/notes-canvas-pane` into `main`.

---

## Self-Review Notes

- **Spec coverage:** content model (Task 6 editor), separate per-window persistence (Tasks 2/4), durable content files (Tasks 2/5), notes-outside-recovery (Task 4 load-on-mount + Task 8 discard wiring), spawn UX + Cmd+Shift+N (Tasks 7/8), distinct counts (Tasks 7/8), close-confirm (Task 8), workspace reassignment (Tasks 4/8), Vitest bootstrap + all listed tests (Tasks 1/4/5) + Rust tests (Task 2). All covered.
- **Type consistency:** `PersistedNote` uses snake_case `workspace_id` at the IPC/Rust boundary (Tasks 2/3) and `NotePane` uses `workspaceId` in React (Tasks 3/4); `useNotes.fromPersisted`/`toPersisted` convert between them. `onClosePane`/`onRenamePane`/`onNewNote`/`panes` names match across Tasks 7 and 8.
- **Open confirmation at install:** the exact TipTap task-list package split (separate vs. bundled in StarterKit v3) is verified in Task 6 Step 1, with a fallback import path noted.
