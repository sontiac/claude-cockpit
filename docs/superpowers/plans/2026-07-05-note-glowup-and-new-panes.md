# Note Glow-Up + Markdown Viewer & Pomodoro Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rich note editing (toolbar buttons, green completed-task treatment, task progress bar), generalized canvas-pane persistence, a markdown file viewer pane with auto-reload, and a pomodoro timer pane.

**Architecture:** Notes/viewers/timers are all "canvas panes" — a discriminated union persisted per-window through the existing notes store (extended with a defaulted `kind` and optional per-kind fields). Each pane kind gets its own cell component on the free-form canvas; shared header chrome is extracted into `PaneHeader`. Pure logic (task counting, pomodoro clock, file polling) lives in testable modules.

**Tech Stack:** React 19 + TypeScript, TipTap v3 (`@tiptap/*` 3.27.1), Tailwind v4, Tauri 2 (Rust backend), vitest + @testing-library/react, react-markdown + remark-gfm.

**Spec:** `docs/superpowers/specs/2026-07-05-note-glowup-and-new-panes-design.md`

## Global Constraints

- **NEVER build or run the app** (`npm run dev`, `npm run build`, `cargo tauri …`). The user runs it live; verification is `npx vitest run`, `npx tsc --noEmit`, and `cargo test` (in `src-tauri/`) only.
- Green accent everywhere the spec says green: `#10b981` (Tailwind `emerald-500`; already the app's terminal green).
- Break-phase accent: `#06b6d4` (the app cyan).
- New deps (exact): `@tiptap/extension-highlight@^3.27.1`, `@tiptap/extensions@^3.27.1` (promote the transitive dep we import `Placeholder` from), `react-markdown@^10.1.0`, `remark-gfm@^4.0.1`. No others.
- Backend command names stay as they are (`get_window_notes`, `save_window_notes`, …) per spec; only the struct they carry generalizes.
- Pomodoro defaults: 25 min focus / 5 min break. Markdown file size cap: 2 MB. Mtime poll: 2000 ms.
- TDD for every logic module; CSS/JSX visuals are verified by the user in the live app.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (heredoc format).
- All file paths below are relative to the repo root `/Users/sontiac/Code/claude-cockpit`.

---

## Part 1 — Note glow-up

### Task 1: Task-progress counter

**Files:**
- Create: `src/lib/noteProgress.ts`
- Test: `src/lib/noteProgress.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `taskProgress(doc: unknown): TaskProgress` where `interface TaskProgress { done: number; total: number }`. Task 2's toolbar calls `taskProgress(editor.getJSON())`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/noteProgress.test.ts
import { describe, it, expect } from "vitest";
import { taskProgress } from "./noteProgress";

describe("taskProgress", () => {
  it("returns 0/0 for empty or missing docs", () => {
    expect(taskProgress(null)).toEqual({ done: 0, total: 0 });
    expect(taskProgress(undefined)).toEqual({ done: 0, total: 0 });
    expect(taskProgress({ type: "doc", content: [] })).toEqual({ done: 0, total: 0 });
    expect(taskProgress({ type: "doc", content: [{ type: "paragraph" }] })).toEqual({
      done: 0,
      total: 0,
    });
  });

  it("counts checked and unchecked task items", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] },
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
          ],
        },
      ],
    };
    expect(taskProgress(doc)).toEqual({ done: 2, total: 3 });
  });

  it("counts nested task lists (task items inside task items)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph" },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: true },
                      content: [{ type: "paragraph" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(taskProgress(doc)).toEqual({ done: 1, total: 2 });
  });

  it("treats a task item without attrs as unchecked", () => {
    const doc = {
      type: "doc",
      content: [{ type: "taskList", content: [{ type: "taskItem" }] }],
    };
    expect(taskProgress(doc)).toEqual({ done: 0, total: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/noteProgress.test.ts`
Expected: FAIL — cannot find module `./noteProgress`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/noteProgress.ts
export interface TaskProgress {
  done: number;
  total: number;
}

interface PmNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
}

function walk(node: PmNode | null | undefined, acc: TaskProgress): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "taskItem") {
    acc.total++;
    if (node.attrs?.checked === true) acc.done++;
  }
  for (const child of node.content ?? []) walk(child, acc);
}

/**
 * Counts checklist completion in a ProseMirror doc (TipTap `getJSON()` output):
 * every `taskItem` node, at any nesting depth, and how many are checked.
 * Feeds the progress bar in the note toolbar.
 */
export function taskProgress(doc: unknown): TaskProgress {
  const acc: TaskProgress = { done: 0, total: 0 };
  walk(doc as PmNode | null | undefined, acc);
  return acc;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/noteProgress.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/noteProgress.ts src/lib/noteProgress.test.ts
git commit -m "$(cat <<'EOF'
feat(notes): task-progress counter for checklist docs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 2: NoteEditor — full toolbar, highlight, placeholder, progress bar

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/components/terminal/NoteEditor.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `taskProgress` from Task 1.
- Produces: `NoteEditor({ initialContent, onChange })` — same public props as today; no consumer changes.

- [ ] **Step 1: Install the extensions**

Run: `npm install @tiptap/extension-highlight@^3.27.1 @tiptap/extensions@^3.27.1`
Expected: both added to `dependencies` at 3.27.1 (matching the other `@tiptap/*` packages).

- [ ] **Step 2: Rewrite NoteEditor**

Replace the entire contents of `src/components/terminal/NoteEditor.tsx` with:

```tsx
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extensions";
import {
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  ListTodo,
  List,
  Quote,
  Minus,
  Undo2,
  Redo2,
  Check,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { taskProgress } from "../../lib/noteProgress";

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

function Divider() {
  return <div className="w-px h-4 bg-card-border mx-0.5 flex-shrink-0" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  // Re-renders on every editor transaction so button active-states and the
  // task progress stay live. Notes are small docs; getJSON per keystroke is fine.
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      highlight: editor.isActive("highlight"),
      taskList: editor.isActive("taskList"),
      bulletList: editor.isActive("bulletList"),
      blockquote: editor.isActive("blockquote"),
      progress: taskProgress(editor.getJSON()),
    }),
  });
  const { done, total } = s.progress;
  const allDone = total > 0 && done === total;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-card-border bg-background-secondary/20 flex-wrap">
      <ToolbarButton
        title="Heading 1"
        active={s.h1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Heading 2"
        active={s.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Heading 3"
        active={s.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="Bold (Cmd+B)"
        active={s.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Italic (Cmd+I)"
        active={s.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        active={s.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Highlight"
        active={s.highlight}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="Checklist"
        active={s.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Bullet list"
        active={s.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Quote"
        active={s.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Divider line"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton title="Undo" onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={14} />
      </ToolbarButton>
      <ToolbarButton title="Redo" onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={14} />
      </ToolbarButton>

      {total > 0 && (
        <div
          className="ml-auto flex items-center gap-1.5 pl-2 flex-shrink-0"
          title={`${done} of ${total} tasks done`}
        >
          <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                allDone ? "bg-emerald-400" : "bg-emerald-500/80"
              }`}
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>
          {allDone ? (
            <Check size={12} className="text-emerald-400" />
          ) : (
            <span className="text-[10px] tabular-nums text-foreground-muted">
              {done}/{total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A lightweight WYSIWYG note editor. Every feature is a toolbar button;
 * markdown input rules (`# `, `**bold**`, `[] `) keep working as shortcuts
 * but are never required. Checklist completion is tracked live in the toolbar.
 */
export function NoteEditor({ initialContent, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Placeholder.configure({
        placeholder: "Write something — or use the toolbar above…",
      }),
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
      <EditorContent editor={editor} className="flex-1 min-h-0 overflow-auto" />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all existing tests + Task 1's 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/terminal/NoteEditor.tsx
git commit -m "$(cat <<'EOF'
feat(notes): full formatting toolbar with live task progress

Headings, bold/italic/strike, highlight, quote, divider, and undo/redo as
buttons (markdown shortcuts still work but are never required), plus an
empty-note placeholder and a green task-progress bar in the toolbar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 3: Note CSS — green checkboxes, headings, blockquote, highlight, placeholder

**Files:**
- Modify: `src/styles/globals.css` (the `.note-prose` block, currently lines 163–169)
- Modify: `src/components/terminal/NoteCell.tsx` (accent CSS variable on the root)

**Interfaces:**
- Consumes: TipTap task-item DOM (`ul[data-type="taskList"] li > label > input[type="checkbox"]`), Placeholder's `p.is-editor-empty` + `data-placeholder`.
- Produces: `--note-accent` CSS custom property, set per-note from `note.color`.

- [ ] **Step 1: Set the accent variable in NoteCell**

In `src/components/terminal/NoteCell.tsx`, add `CSSProperties` to imports and set the variable on the root div.

Change the react import line at the top:

```tsx
import { useState, useCallback } from "react";
import type React from "react";
import type { CSSProperties } from "react";
```

Change the root element (currently `<div className={...} onClick={onSelect}>`):

```tsx
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
      style={{ "--note-accent": note.color } as CSSProperties}
    >
```

- [ ] **Step 2: Replace the note CSS block**

In `src/styles/globals.css`, replace the existing `/* Note editor (TipTap) */` block (six `.note-prose` lines) with:

```css
/* Note editor (TipTap) */
.note-prose p { margin: 0.15rem 0; }
.note-prose ul:not([data-type="taskList"]) { list-style: disc; padding-left: 1.25rem; }
.note-prose ol { list-style: decimal; padding-left: 1.25rem; }

.note-prose h1 {
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0.6rem 0 0.25rem;
  color: var(--note-accent, inherit);
}
.note-prose h2 { font-size: 1.15rem; font-weight: 650; margin: 0.5rem 0 0.2rem; }
.note-prose h3 { font-size: 1rem; font-weight: 600; margin: 0.4rem 0 0.15rem; }

.note-prose blockquote {
  border-left: 2px solid var(--note-accent, rgba(148, 163, 184, 0.5));
  padding-left: 0.75rem;
  margin: 0.4rem 0;
  color: var(--foreground-muted);
}
.note-prose hr {
  border: none;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  margin: 0.75rem 0;
}
.note-prose mark {
  background: rgba(250, 204, 21, 0.35);
  color: inherit;
  border-radius: 0.15rem;
  padding: 0 0.1rem;
}
.note-prose code {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 0.85em;
  background: rgba(148, 163, 184, 0.15);
  border-radius: 0.25rem;
  padding: 0.05rem 0.3rem;
}

/* Empty-note placeholder (TipTap Placeholder extension) */
.note-prose p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: rgba(148, 163, 184, 0.4);
  float: left;
  height: 0;
  pointer-events: none;
}

/* Checklists: custom green checkboxes with a pop on check, and a smooth
   green-tinted strikethrough for completed items. */
.note-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.note-prose ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
.note-prose ul[data-type="taskList"] li > label { margin-top: 0.2rem; }
.note-prose ul[data-type="taskList"] li > label input[type="checkbox"] {
  appearance: none;
  width: 1rem;
  height: 1rem;
  border: 1.5px solid rgba(148, 163, 184, 0.5);
  border-radius: 0.3rem;
  background: transparent;
  cursor: pointer;
  position: relative;
  display: block;
  transition: background 150ms ease, border-color 150ms ease;
}
.note-prose ul[data-type="taskList"] li > label input[type="checkbox"]:hover {
  border-color: rgba(16, 185, 129, 0.7);
}
.note-prose ul[data-type="taskList"] li > label input[type="checkbox"]:checked {
  background: #10b981;
  border-color: #10b981;
  animation: check-pop 200ms ease;
}
.note-prose ul[data-type="taskList"] li > label input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
@keyframes check-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.25); }
  100% { transform: scale(1); }
}
.note-prose ul[data-type="taskList"] li > div {
  flex: 1;
  transition: color 200ms ease;
}
.note-prose ul[data-type="taskList"] li[data-checked="true"] > div {
  text-decoration: line-through;
  text-decoration-color: rgba(16, 185, 129, 0.6);
  color: rgba(134, 239, 172, 0.55);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean. (Visuals are the user's to verify in the live app — do not build/run.)

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css src/components/terminal/NoteCell.tsx
git commit -m "$(cat <<'EOF'
feat(notes): green animated checkboxes, styled headings/quote/highlight

Completed tasks get a filled green checkbox with a pop animation and a
smooth green-tinted strikethrough; headings/blockquote pick up the note's
accent color; empty notes show a placeholder hint.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Part 2 — Pane infrastructure

### Task 4: Rust — `PersistedNote` → `PersistedPane` with kind + per-kind fields

**Files:**
- Modify: `src-tauri/src/notes/store.rs`
- Modify: `src-tauri/src/commands/notes.rs`

**Interfaces:**
- Produces (consumed by Task 5's TS `PersistedPane`): JSON objects shaped
  `{ id, label, color, workspace_id, kind, path?, work_minutes?, break_minutes? }`;
  `kind` defaults to `"note"` when absent. Command names unchanged.

- [ ] **Step 1: Write the failing Rust tests**

In `src-tauri/src/notes/store.rs`, update the test helper and add two tests inside `mod tests` (the helper must gain the new fields so existing tests keep compiling):

```rust
    fn note(id: &str) -> PersistedPane {
        PersistedPane {
            id: id.into(),
            label: "Note".into(),
            color: "#fff".into(),
            workspace_id: Some("ws-1".into()),
            kind: "note".into(),
            path: None,
            work_minutes: None,
            break_minutes: None,
        }
    }

    #[test]
    fn legacy_note_json_defaults_to_note_kind() {
        let json = r#"[{"id":"n-1","label":"Todo","color":"#abc","workspace_id":"ws-9"}]"#;
        let panes: Vec<PersistedPane> = serde_json::from_str(json).unwrap();
        assert_eq!(panes[0].kind, "note");
        assert_eq!(panes[0].path, None);
        assert_eq!(panes[0].work_minutes, None);
    }

    #[test]
    fn pane_kinds_round_trip() {
        let label = "test-window-kinds";
        let panes = vec![
            note("n-1"),
            PersistedPane {
                id: "v-1".into(),
                label: "Plan".into(),
                color: "#0af".into(),
                workspace_id: Some("ws-1".into()),
                kind: "mdviewer".into(),
                path: Some("/tmp/plan.md".into()),
                work_minutes: None,
                break_minutes: None,
            },
            PersistedPane {
                id: "p-1".into(),
                label: "Pomodoro".into(),
                color: "#f80".into(),
                workspace_id: Some("ws-1".into()),
                kind: "pomodoro".into(),
                path: None,
                work_minutes: Some(25),
                break_minutes: Some(5),
            },
        ];
        save_window_notes(label, &panes).unwrap();
        assert_eq!(get_window_notes(label), panes);
        fs::remove_file(window_file(label).unwrap()).ok();
    }
```

Also update the existing `window_notes_round_trip` test only if it fails to compile (it uses the `note()` helper, which now returns the new struct — it should compile unchanged).

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test notes`
Expected: compile error — `PersistedPane` not defined.

- [ ] **Step 3: Generalize the struct**

In `src-tauri/src/notes/store.rs`, replace the `PersistedNote` definition (lines 5–14) with:

```rust
fn default_kind() -> String {
    "note".into()
}

/// A persisted canvas pane: enough to recreate the window on next launch.
/// Note text content lives separately (content file keyed by id), never here.
/// `kind` selects the pane type; per-kind config rides along as optional
/// fields the store never interprets. Files written before panes had kinds
/// deserialize as notes via the `kind` default.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedPane {
    pub id: String,
    pub label: String,
    pub color: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
    /// mdviewer: absolute path of the markdown file being viewed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// pomodoro: focus duration in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_minutes: Option<u32>,
    /// pomodoro: break duration in minutes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub break_minutes: Option<u32>,
}
```

Then rename the remaining `PersistedNote` references in this file: `get_window_notes` returns `Vec<PersistedPane>`, `save_window_notes` takes `&[PersistedPane]`.

In `src-tauri/src/commands/notes.rs`, update the import and the two signatures:

```rust
use crate::notes::store::{self, PersistedPane};

#[tauri::command]
pub fn get_window_notes(label: String) -> Result<Vec<PersistedPane>, CockpitError> {
    Ok(store::get_window_notes(&label))
}

#[tauri::command]
pub fn save_window_notes(label: String, notes: Vec<PersistedPane>) -> Result<(), CockpitError> {
    store::save_window_notes(&label, &notes)
}
```

(The other five commands are untouched.)

- [ ] **Step 4: Run to verify pass**

Run: `cd src-tauri && cargo test notes`
Expected: all notes-store tests pass, including the two new ones.
Then: `cargo test` (full backend suite) — all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notes/store.rs src-tauri/src/commands/notes.rs
git commit -m "$(cat <<'EOF'
feat(panes): generalize persisted note record to PersistedPane

Adds a defaulted `kind` plus optional per-kind fields (mdviewer path,
pomodoro durations). The store stays a dumb persistence record; command
names are unchanged. Pre-existing files deserialize as notes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 5: TS — pane types + `usePanes` hook

**Files:**
- Modify: `src/types/pane.ts` (full rewrite below)
- Create: `src/hooks/usePanes.ts` (replaces `src/hooks/useNotes.ts` — delete it)
- Create: `src/hooks/usePanes.test.ts` (replaces `src/hooks/useNotes.test.ts` — delete it)
- Modify: `src/lib/ipc.ts` (type rename only)

**Interfaces:**
- Consumes: Task 4's persisted shape via the existing `get_window_notes`/`save_window_notes` IPC.
- Produces (used by Task 6's App wiring):
  - Types: `CanvasPane`, `CanvasPaneKind = "note" | "mdviewer" | "pomodoro"`, `NotePane`, `MdViewerPane`, `PomodoroPane`, `Pane`, `PersistedPane`.
  - Hook: `usePanes()` returning `{ panes: CanvasPane[]; addPane(kind, workspaceId): CanvasPane; renamePane(id, label); movePane(id, workspaceId); removePane(id); reassignPanes(from, to); discardPanes(): Promise<void>; forgetWindowPanes(): Promise<void>; setPanePath(id, path: string | null); setPomodoroDurations(id, workMinutes: number, breakMinutes: number) }`.

- [ ] **Step 1: Rewrite the types**

Replace the entire contents of `src/types/pane.ts` with:

```ts
import type { TerminalInfo } from "./terminal";

/** Fields every non-terminal canvas pane shares. */
export interface CanvasPaneBase {
  id: string;
  label: string;
  color: string;
  workspaceId: string;
}

/** A note (content lives in its own file, keyed by id). */
export type NotePane = CanvasPaneBase & { kind: "note" };

/** A read-only markdown file viewer pointed at an absolute path. */
export type MdViewerPane = CanvasPaneBase & { kind: "mdviewer"; path: string | null };

/** A pomodoro timer; durations persist, the running clock does not. */
export type PomodoroPane = CanvasPaneBase & {
  kind: "pomodoro";
  workMinutes: number;
  breakMinutes: number;
};

export type CanvasPane = NotePane | MdViewerPane | PomodoroPane;
export type CanvasPaneKind = CanvasPane["kind"];

/** The persisted pane shape written to notes/windows/{label}.json (Rust: PersistedPane). */
export interface PersistedPane {
  id: string;
  label: string;
  color: string;
  workspace_id: string | null;
  kind?: string;
  path?: string | null;
  work_minutes?: number | null;
  break_minutes?: number | null;
}

/** A pane on the canvas: a live terminal or any canvas pane. */
export type Pane = ({ kind: "terminal" } & TerminalInfo) | CanvasPane;
```

- [ ] **Step 2: Update ipc.ts type references**

In `src/lib/ipc.ts`, change the `PersistedNote` import/usages to `PersistedPane` (the `getWindowNotes` return type and `saveWindowNotes` parameter type; command strings unchanged).

- [ ] **Step 3: Write the failing tests**

`git mv src/hooks/useNotes.test.ts src/hooks/usePanes.test.ts`, then replace its contents with:

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
  removeWindowNotes: vi.fn(async () => {}),
  clearNotes: vi.fn(async () => {}),
}));
vi.mock("../lib/ipc", () => ipc);

import { usePanes } from "./usePanes";

beforeEach(() => {
  vi.clearAllMocks();
  ipc.getWindowNotes.mockResolvedValue([]);
});

describe("usePanes", () => {
  it("adds a note into the given workspace", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addPane("note", "ws-1");
    });
    expect(result.current.panes).toHaveLength(1);
    expect(result.current.panes[0]).toMatchObject({ kind: "note", workspaceId: "ws-1" });
  });

  it("adds mdviewer and pomodoro panes with per-kind defaults", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addPane("mdviewer", "ws-1");
      result.current.addPane("pomodoro", "ws-1");
    });
    expect(result.current.panes[0]).toMatchObject({ kind: "mdviewer", path: null, label: "Plan" });
    expect(result.current.panes[1]).toMatchObject({
      kind: "pomodoro",
      workMinutes: 25,
      breakMinutes: 5,
      label: "Pomodoro",
    });
  });

  it("renames and removes panes (note removal deletes its content file)", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addPane("note", "ws-1").id;
    });
    act(() => result.current.renamePane(id, "Groceries"));
    expect(result.current.panes[0].label).toBe("Groceries");

    act(() => result.current.removePane(id));
    expect(result.current.panes).toHaveLength(0);
    expect(ipc.removeNoteContent).toHaveBeenCalledWith(id);
  });

  it("reassigns panes from a deleted workspace to a fallback", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addPane("note", "ws-doomed");
    });
    act(() => result.current.reassignPanes("ws-doomed", "ws-keep"));
    expect(result.current.panes[0].workspaceId).toBe("ws-keep");
  });

  it("moves a single pane to another workspace, leaving others", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let a = "";
    let b = "";
    act(() => {
      a = result.current.addPane("note", "ws-1").id;
      b = result.current.addPane("note", "ws-1").id;
    });
    act(() => result.current.movePane(a, "ws-2"));

    const moved = result.current.panes.find((p) => p.id === a);
    const other = result.current.panes.find((p) => p.id === b);
    expect(moved?.workspaceId).toBe("ws-2");
    expect(other?.workspaceId).toBe("ws-1");
  });

  it("restores panes loaded from disk, defaulting missing kind to note", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
      {
        id: "v-1",
        label: "Plan",
        color: "#0af",
        workspace_id: "ws-9",
        kind: "mdviewer",
        path: "/tmp/plan.md",
      },
      {
        id: "p-1",
        label: "Pomodoro",
        color: "#f80",
        workspace_id: "ws-9",
        kind: "pomodoro",
        work_minutes: 50,
        break_minutes: 10,
      },
    ]);
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(result.current.panes).toHaveLength(3));
    expect(result.current.panes[0]).toEqual({
      id: "n-1",
      label: "Todo",
      color: "#abc",
      workspaceId: "ws-9",
      kind: "note",
    });
    expect(result.current.panes[1]).toEqual({
      id: "v-1",
      label: "Plan",
      color: "#0af",
      workspaceId: "ws-9",
      kind: "mdviewer",
      path: "/tmp/plan.md",
    });
    expect(result.current.panes[2]).toEqual({
      id: "p-1",
      label: "Pomodoro",
      color: "#f80",
      workspaceId: "ws-9",
      kind: "pomodoro",
      workMinutes: 50,
      breakMinutes: 10,
    });
  });

  it("setPanePath updates the target mdviewer and persists it", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addPane("mdviewer", "ws-1").id;
    });
    act(() => result.current.setPanePath(id, "/tmp/plan.md"));

    const pane = result.current.panes[0];
    expect(pane.kind === "mdviewer" && pane.path).toBe("/tmp/plan.md");
    await waitFor(() => {
      const lastSave = ipc.saveWindowNotes.mock.calls.at(-1);
      expect(lastSave?.[1]).toEqual([expect.objectContaining({ path: "/tmp/plan.md" })]);
    });
  });

  it("setPomodoroDurations updates the target pomodoro", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addPane("pomodoro", "ws-1").id;
    });
    act(() => result.current.setPomodoroDurations(id, 50, 10));
    expect(result.current.panes[0]).toMatchObject({ workMinutes: 50, breakMinutes: 10 });
  });

  it("does not persist before the initial load completes", async () => {
    let resolveLoad: (v: any[]) => void = () => {};
    ipc.getWindowNotes.mockReturnValue(new Promise((r) => (resolveLoad = r)) as any);
    renderHook(() => usePanes());
    expect(ipc.saveWindowNotes).not.toHaveBeenCalled();
    await act(async () => resolveLoad([]));
  });

  it("discardPanes clears state and files", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
    ]);
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(result.current.panes).toHaveLength(1));

    await act(async () => {
      await result.current.discardPanes();
    });
    expect(result.current.panes).toHaveLength(0);
    expect(ipc.clearNotes).toHaveBeenCalled();
  });

  it("forgetWindowPanes deletes note content + this window's file, without re-saving", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "A", color: "#abc", workspace_id: "ws-1" },
      { id: "n-2", label: "B", color: "#abc", workspace_id: "ws-1" },
    ]);
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(result.current.panes).toHaveLength(2));
    ipc.saveWindowNotes.mockClear();

    await act(async () => {
      await result.current.forgetWindowPanes();
    });

    expect(ipc.removeNoteContent).toHaveBeenCalledWith("n-1");
    expect(ipc.removeNoteContent).toHaveBeenCalledWith("n-2");
    expect(ipc.removeWindowNotes).toHaveBeenCalledWith("main");
    expect(result.current.panes).toHaveLength(0);
    expect(ipc.saveWindowNotes).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/hooks/usePanes.test.ts`
Expected: FAIL — cannot find module `./usePanes`.

- [ ] **Step 5: Write the hook**

`git mv src/hooks/useNotes.ts src/hooks/usePanes.ts`, then replace its contents with:

```ts
import { useState, useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getWindowNotes,
  saveWindowNotes,
  removeNoteContent,
  removeWindowNotes,
  clearNotes,
} from "../lib/ipc";
import { generateId } from "../lib/utils";
import { PROJECT_COLORS } from "../lib/constants";
import type { CanvasPane, CanvasPaneKind, PersistedPane } from "../types/pane";

const WINDOW_LABEL = getCurrentWindow().label;

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;

const KIND_LABELS: Record<CanvasPaneKind, string> = {
  note: "Note",
  mdviewer: "Plan",
  pomodoro: "Pomodoro",
};

function toPersisted(p: CanvasPane): PersistedPane {
  return {
    id: p.id,
    label: p.label,
    color: p.color,
    workspace_id: p.workspaceId,
    kind: p.kind,
    path: p.kind === "mdviewer" ? p.path : null,
    work_minutes: p.kind === "pomodoro" ? p.workMinutes : null,
    break_minutes: p.kind === "pomodoro" ? p.breakMinutes : null,
  };
}

function fromPersisted(p: PersistedPane): CanvasPane {
  const base = {
    id: p.id,
    label: p.label,
    color: p.color,
    workspaceId: p.workspace_id ?? "",
  };
  switch (p.kind) {
    case "mdviewer":
      return { ...base, kind: "mdviewer", path: p.path ?? null };
    case "pomodoro":
      return {
        ...base,
        kind: "pomodoro",
        workMinutes: p.work_minutes ?? DEFAULT_WORK_MINUTES,
        breakMinutes: p.break_minutes ?? DEFAULT_BREAK_MINUTES,
      };
    default:
      // Files written before panes had kinds are notes; unknown kinds from a
      // newer version degrade to notes rather than being dropped.
      return { ...base, kind: "note" };
  }
}

/**
 * Owns the non-terminal canvas panes (notes, markdown viewers, pomodoros) for
 * this window and persists them to their own per-window file. Deliberately
 * independent of `useTerminals` / `WindowState` / the recovery modal: panes are
 * durable, so they load immediately on launch and are never gated behind a
 * Recover/Discard choice. Note text content lives in separate per-id files.
 */
export function usePanes() {
  const [panes, setPanes] = useState<CanvasPane[]>([]);
  // Disarm persistence until the initial load completes, so the empty initial
  // state can't overwrite the saved file.
  const [loaded, setLoaded] = useState(false);
  // Set while this window is being closed/forgotten, so the persist effect
  // doesn't re-create the pane file we just removed.
  const closingRef = useRef(false);

  const addPane = useCallback(
    (kind: CanvasPaneKind, workspaceId: string): CanvasPane => {
      const base = {
        id: generateId(),
        label: KIND_LABELS[kind],
        color: PROJECT_COLORS[Math.floor(Date.now()) % PROJECT_COLORS.length],
        workspaceId,
      };
      const pane: CanvasPane =
        kind === "mdviewer"
          ? { ...base, kind, path: null }
          : kind === "pomodoro"
            ? {
                ...base,
                kind,
                workMinutes: DEFAULT_WORK_MINUTES,
                breakMinutes: DEFAULT_BREAK_MINUTES,
              }
            : { ...base, kind: "note" };
      setPanes((prev) => [...prev, pane]);
      return pane;
    },
    []
  );

  const renamePane = useCallback((id: string, label: string) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, label } : p)));
  }, []);

  const movePane = useCallback((id: string, workspaceId: string) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, workspaceId } : p)));
  }, []);

  const removePane = useCallback((id: string) => {
    setPanes((prev) => prev.filter((p) => p.id !== id));
    // Only notes have content files, but removal of a missing file is a no-op
    // backend-side, so this stays unconditional and simple.
    removeNoteContent(id).catch((e) =>
      console.error("Failed to remove note content:", e)
    );
  }, []);

  const setPanePath = useCallback((id: string, path: string | null) => {
    setPanes((prev) =>
      prev.map((p) => (p.id === id && p.kind === "mdviewer" ? { ...p, path } : p))
    );
  }, []);

  const setPomodoroDurations = useCallback(
    (id: string, workMinutes: number, breakMinutes: number) => {
      setPanes((prev) =>
        prev.map((p) =>
          p.id === id && p.kind === "pomodoro" ? { ...p, workMinutes, breakMinutes } : p
        )
      );
    },
    []
  );

  const reassignPanes = useCallback(
    (fromWorkspaceId: string, toWorkspaceId: string) => {
      setPanes((prev) =>
        prev.map((p) =>
          p.workspaceId === fromWorkspaceId ? { ...p, workspaceId: toWorkspaceId } : p
        )
      );
    },
    []
  );

  const discardPanes = useCallback(async () => {
    setPanes([]);
    await clearNotes().catch((e) => console.error("Failed to clear panes:", e));
  }, []);

  // Forget this window's panes when the window is deliberately closed: delete
  // every note's content file, then remove this window's pane-list file. Guards
  // persistence first so the subsequent empty state can't re-save the file.
  const forgetWindowPanes = useCallback(async () => {
    closingRef.current = true;
    await Promise.all(
      panes
        .filter((p) => p.kind === "note")
        .map((p) =>
          removeNoteContent(p.id).catch((e) =>
            console.error("Failed to remove note content:", e)
          )
        )
    );
    await removeWindowNotes(WINDOW_LABEL).catch((e) =>
      console.error("Failed to remove window panes:", e)
    );
    setPanes([]);
  }, [panes]);

  // Load this window's saved panes on mount, then arm persistence.
  useEffect(() => {
    (async () => {
      try {
        const persisted = await getWindowNotes(WINDOW_LABEL);
        setPanes(persisted.map(fromPersisted));
      } catch (error) {
        console.error("Failed to load panes:", error);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Persist whenever panes change, once armed (and not while closing).
  useEffect(() => {
    if (!loaded || closingRef.current) return;
    saveWindowNotes(WINDOW_LABEL, panes.map(toPersisted)).catch((e) =>
      console.error("Failed to persist panes:", e)
    );
  }, [panes, loaded]);

  return {
    panes,
    addPane,
    renamePane,
    movePane,
    removePane,
    reassignPanes,
    discardPanes,
    forgetWindowPanes,
    setPanePath,
    setPomodoroDurations,
  };
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/hooks/usePanes.test.ts`
Expected: 11 passed. (`npx tsc --noEmit` will FAIL at this point — `App.tsx` still imports `useNotes`. That is Task 6; do not typecheck-gate this step, but do run the vitest file.)

- [ ] **Step 7: Commit**

(Committing mid-refactor with App not yet migrated would break `main`; instead, proceed straight to Task 6 and commit both together — Task 6's commit covers Tasks 5+6. Skip the commit here.)

### Task 6: App / canvas / toolbar wiring for canvas panes

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/terminal/TerminalGrid.tsx`
- Modify: `src/components/terminal/TerminalCanvas.tsx`
- Modify: `src/components/layout/WorkspaceBar.tsx`
- Modify: `src/components/terminal/NoteCell.tsx` (prop type only)
- Modify: `src/lib/windowClose.ts` + `src/lib/windowClose.test.ts` (wording: notes → panes)

**Interfaces:**
- Consumes: `usePanes` from Task 5.
- Produces (relied on by Tasks 9–12):
  - `TerminalGrid` prop `onNewPane: (kind: CanvasPaneKind) => void` (replaces `onNewNote`).
  - `TerminalCanvas` props `onSetPanePath: (id: string, path: string | null) => void` and `onSetPomodoroDurations: (id: string, workMinutes: number, breakMinutes: number) => void` threaded from App (`setPanePath` / `setPomodoroDurations`).
  - Canvas renders `pane.kind === "note"` via `NoteCell`; `mdviewer`/`pomodoro` render `null` until their cells land (nothing can create them yet — no toolbar buttons for them until Tasks 10/12).

- [ ] **Step 1: Migrate App.tsx**

In `src/App.tsx`:

1. Replace the import `import { useNotes } from "./hooks/useNotes";` with `import { usePanes } from "./hooks/usePanes";` and add `CanvasPaneKind` to the pane types import (`import type { Pane, CanvasPaneKind } from "./types/pane";` — adjust to match the existing import line).
2. Replace the `useNotes()` destructure (lines 48–57) with:

```ts
  const {
    panes,
    addPane,
    renamePane: renameCanvasPane,
    movePane: moveCanvasPane,
    removePane,
    reassignPanes,
    discardPanes,
    forgetWindowPanes,
    setPanePath,
    setPomodoroDurations,
  } = usePanes();
```

3. Replace `handleNewNote` with:

```ts
  const handleNewPane = useCallback(
    (kind: CanvasPaneKind, workspaceId?: string) => {
      const pane = addPane(kind, workspaceId ?? activeWorkspaceId);
      setActiveId(pane.id);
      play("launch");
    },
    [addPane, activeWorkspaceId, setActiveId, play]
  );
```

4. Replace `closePane` with (only notes need a delete confirmation — closing a viewer or timer loses nothing durable):

```ts
  const closePane = useCallback(
    (id: string) => {
      const pane = panes.find((p) => p.id === id);
      if (pane) {
        if (
          pane.kind === "note" &&
          !window.confirm(
            `Delete note "${pane.label}"? Its contents will be permanently removed.`
          )
        ) {
          return;
        }
        removePane(id);
        if (activeId === id) setActiveId(null);
        play("click");
        return;
      }
      kill(id);
    },
    [panes, removePane, kill, activeId, setActiveId, play]
  );
```

5. Update `renamePane` / `movePane` wrappers to use `panes` + the aliased hook fns:

```ts
  const renamePane = useCallback(
    (id: string, label: string) => {
      if (panes.some((p) => p.id === id)) renameCanvasPane(id, label);
      else rename(id, label);
    },
    [panes, renameCanvasPane, rename]
  );

  const movePane = useCallback(
    (id: string, workspaceId: string) => {
      if (panes.some((p) => p.id === id)) moveCanvasPane(id, workspaceId);
      else moveTerminal(id, workspaceId);
    },
    [panes, moveCanvasPane, moveTerminal]
  );
```

6. Rename every remaining reference in App.tsx (the compiler will catch stragglers):
   - keyboard shortcut handler `handleNewNote()` → `handleNewPane("note")` (and the effect dependency `handleNewNote` → `handleNewPane`)
   - Sidebar prop `onNewNote={() => handleNewNote()}` → `onNewNote={() => handleNewPane("note")}`
   - `workspaceNoteCounts` computation: `notes` → `panes`; pass to WorkspaceBar as `paneCounts={workspacePaneCounts}` (rename the variable too)
   - `closeConfirmMessage(terminals.length, notes.length)` → `closeConfirmMessage(terminals.length, panes.length)` and the dependency array `notes.length` → `panes.length`, `forgetWindowNotes` → `forgetWindowPanes`
   - `handleDeleteWorkspace`'s `reassignNotes` → `reassignPanes` (call + deps)
   - the restore/discard flow's `discardNotes` → `discardPanes`
   - `wsPanes` construction becomes:

```tsx
              const wsPanes: Pane[] = [
                ...terminals
                  .filter((t) => t.workspaceId === ws.id)
                  .map((t) => ({ kind: "terminal" as const, ...t })),
                ...panes.filter((p) => p.workspaceId === ws.id),
              ];
```

   - `TerminalGrid` usage: `onNewNote={() => handleNewNote(ws.id)}` → `onNewPane={(kind) => handleNewPane(kind, ws.id)}`, and add `onSetPanePath={setPanePath}` `onSetPomodoroDurations={setPomodoroDurations}`.

- [ ] **Step 2: Update TerminalGrid**

In `src/components/terminal/TerminalGrid.tsx`:

1. Props: replace `onNewNote: () => void;` with `onNewPane: (kind: CanvasPaneKind) => void;` and add `onSetPanePath: (id: string, path: string | null) => void;` and `onSetPomodoroDurations: (id: string, workMinutes: number, breakMinutes: number) => void;`. Import `CanvasPaneKind` from `../../types/pane`.
2. Every `onNewNote` call becomes `onNewPane("note")` (toolbar button + empty-state button).
3. Update `countLabel` to cover the new kinds:

```tsx
  const termCount = panes.filter((p) => p.kind === "terminal").length;
  const noteCount = panes.filter((p) => p.kind === "note").length;
  const viewerCount = panes.filter((p) => p.kind === "mdviewer").length;
  const timerCount = panes.filter((p) => p.kind === "pomodoro").length;

  const countLabel =
    [
      termCount > 0 ? `${termCount} terminal${termCount !== 1 ? "s" : ""}` : "",
      noteCount > 0 ? `${noteCount} note${noteCount !== 1 ? "s" : ""}` : "",
      viewerCount > 0 ? `${viewerCount} plan${viewerCount !== 1 ? "s" : ""}` : "",
      timerCount > 0 ? `${timerCount} timer${timerCount !== 1 ? "s" : ""}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Empty";
```

4. Pass `onSetPanePath` and `onSetPomodoroDurations` through to `<TerminalCanvas … />`.

- [ ] **Step 3: Update TerminalCanvas**

In `src/components/terminal/TerminalCanvas.tsx`:

1. Add to props: `onSetPanePath: (id: string, path: string | null) => void;` and `onSetPomodoroDurations: (id: string, workMinutes: number, breakMinutes: number) => void;` (destructure them; they are consumed in Tasks 10/12).
2. Replace the cell selection ternary with a kind switch:

```tsx
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
                  workspaces={workspaces}
                  onMove={(wsId) => onMovePane(pane.id, wsId)}
                />
              ) : pane.kind === "note" ? (
                <NoteCell
                  note={pane}
                  isActive={isActive}
                  onSelect={() => onSelect(pane.id)}
                  onClose={() => onClosePane(pane.id)}
                  onRename={(label) => onRenamePane(pane.id, label)}
                  onHeaderPointerDown={headerPointerDown}
                  workspaces={workspaces}
                  onMove={(wsId) => onMovePane(pane.id, wsId)}
                />
              ) : null /* mdviewer (Task 10) and pomodoro (Task 12) cells land with their features; nothing can create these kinds until their toolbar buttons exist */}
```

- [ ] **Step 4: Update WorkspaceBar + NoteCell prop type + windowClose wording**

1. `src/components/layout/WorkspaceBar.tsx`: rename the `noteCounts` prop to `paneCounts` (interface line 9, destructure line 26, usages lines 89–95); change the title string to `` `${paneCounts[ws.id]} pane${paneCounts[ws.id] !== 1 ? "s" : ""}` ``.
2. `src/components/terminal/NoteCell.tsx`: the `note: NotePane` prop type is unchanged in name — verify the import still resolves (`NotePane` still exists in `types/pane.ts`).
3. `src/lib/windowClose.ts`: update the message wording from notes to panes (whatever the current copy is, replace the word "note(s)" with "pane(s)"); update the corresponding assertions in `src/lib/windowClose.test.ts` to the new copy.

- [ ] **Step 5: Verify everything**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean, full suite green (usePanes tests, windowClose tests with new copy, everything else untouched).

- [ ] **Step 6: Commit (covers Tasks 5+6)**

```bash
git add -A src src-tauri
git commit -m "$(cat <<'EOF'
feat(panes): generalize notes into canvas panes (note/mdviewer/pomodoro)

useNotes becomes usePanes: one persisted per-window list of typed canvas
panes with per-kind config (mdviewer path, pomodoro durations). App,
canvas, grid, and workspace bar speak "panes"; note behavior unchanged.
New kinds have types + persistence but no UI yet — their cells land with
their features.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Part 3 — Markdown viewer pane

### Task 7: Rust — `stat_file` / `read_text_file` commands

**Files:**
- Modify: `src-tauri/src/commands/system.rs`
- Modify: `src-tauri/src/lib.rs` (register the two commands)

**Interfaces:**
- Produces (consumed by Task 8's ipc wrappers): `stat_file(path: String) -> u64` (mtime in ms since epoch) and `read_text_file(path: String) -> { content: String, mtime_ms: u64 }`. Both accept `~`-prefixed paths via the existing `resolve_path`. Files over 2 MB are rejected with `InvalidInput`.

- [ ] **Step 1: Write the failing Rust tests**

Append to `src-tauri/src/commands/system.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_text_file_round_trips_and_stat_matches() {
        let path = std::env::temp_dir().join("cockpit-read-text-test.md");
        fs::write(&path, "# hello").unwrap();
        let s = path.to_string_lossy().to_string();

        let file = read_text_file(s.clone()).unwrap();
        assert_eq!(file.content, "# hello");
        assert!(file.mtime_ms > 0);
        assert_eq!(stat_file(s).unwrap(), file.mtime_ms);

        fs::remove_file(&path).ok();
    }

    #[test]
    fn read_text_file_missing_errors() {
        assert!(read_text_file("/nonexistent/cockpit-missing.md".into()).is_err());
        assert!(stat_file("/nonexistent/cockpit-missing.md".into()).is_err());
    }

    #[test]
    fn read_text_file_rejects_oversize() {
        let path = std::env::temp_dir().join("cockpit-oversize-test.md");
        let f = fs::File::create(&path).unwrap();
        f.set_len(MAX_TEXT_FILE_BYTES + 1).unwrap();
        drop(f);
        assert!(read_text_file(path.to_string_lossy().to_string()).is_err());
        fs::remove_file(&path).ok();
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test system`
Expected: compile error — `read_text_file` / `stat_file` / `MAX_TEXT_FILE_BYTES` not defined.

- [ ] **Step 3: Implement the commands**

Add to `src-tauri/src/commands/system.rs` (above the tests; `resolve_path` already exists in this file):

```rust
/// Cap for read_text_file: markdown plans are small; anything bigger than this
/// is not something we should ship to the webview in one string.
const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct TextFile {
    pub content: String,
    pub mtime_ms: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Modification time of a file in ms since epoch. The markdown viewer polls
/// this cheaply and only re-reads the file when it changes.
#[tauri::command]
pub fn stat_file(path: String) -> Result<u64, CockpitError> {
    let meta = fs::metadata(resolve_path(&path))?;
    Ok(mtime_ms(&meta))
}

/// Read a UTF-8 text file for in-app preview (markdown viewer pane).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFile, CockpitError> {
    let resolved = resolve_path(&path);
    let meta = fs::metadata(&resolved)?;
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(CockpitError::InvalidInput(format!(
            "File is too large to preview ({} bytes; max {} bytes)",
            meta.len(),
            MAX_TEXT_FILE_BYTES
        )));
    }
    let content = fs::read_to_string(&resolved)?;
    Ok(TextFile {
        content,
        mtime_ms: mtime_ms(&meta),
    })
}
```

Register in `src-tauri/src/lib.rs` after `commands::system::get_home_dir,`:

```rust
            commands::system::stat_file,
            commands::system::read_text_file,
```

- [ ] **Step 4: Run to verify pass**

Run: `cd src-tauri && cargo test`
Expected: all pass, including the three new system tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/system.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(backend): stat_file + read_text_file commands for the plan viewer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 8: `useMarkdownFile` hook (load + mtime polling)

**Files:**
- Modify: `src/lib/ipc.ts` (two wrappers)
- Create: `src/hooks/useMarkdownFile.ts`
- Test: `src/hooks/useMarkdownFile.test.ts`

**Interfaces:**
- Consumes: Task 7's commands via new ipc wrappers `statFile(path): Promise<number>` and `readTextFile(path): Promise<TextFile>` where `interface TextFile { content: string; mtime_ms: number }`.
- Produces (used by Task 10's cell): `useMarkdownFile(path: string | null): { content: string | null; error: string | null }`.

- [ ] **Step 1: Add the ipc wrappers**

In `src/lib/ipc.ts`, near `getHomeDir`:

```ts
export interface TextFile {
  content: string;
  mtime_ms: number;
}

export const statFile = (path: string) => invoke<number>("stat_file", { path });

export const readTextFile = (path: string) =>
  invoke<TextFile>("read_text_file", { path });
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/hooks/useMarkdownFile.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const ipc = vi.hoisted(() => ({
  readTextFile: vi.fn(async () => ({ content: "# one", mtime_ms: 100 })),
  statFile: vi.fn(async () => 100),
}));
vi.mock("../lib/ipc", () => ipc);

import { useMarkdownFile } from "./useMarkdownFile";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ipc.readTextFile.mockResolvedValue({ content: "# one", mtime_ms: 100 });
  ipc.statFile.mockResolvedValue(100);
});

afterEach(() => {
  vi.useRealTimers();
});

const flush = async () => {
  // Let pending promises settle under fake timers.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useMarkdownFile", () => {
  it("does nothing for a null path", async () => {
    const { result } = renderHook(() => useMarkdownFile(null));
    await flush();
    expect(ipc.readTextFile).not.toHaveBeenCalled();
    expect(result.current).toEqual({ content: null, error: null });
  });

  it("loads the file on mount", async () => {
    const { result } = renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();
    expect(ipc.readTextFile).toHaveBeenCalledWith("/tmp/plan.md");
    expect(result.current).toEqual({ content: "# one", error: null });
  });

  it("does not re-read while the mtime is unchanged", async () => {
    renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(ipc.statFile).toHaveBeenCalled();
    expect(ipc.readTextFile).toHaveBeenCalledTimes(1);
  });

  it("re-reads when the mtime changes", async () => {
    const { result } = renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();

    ipc.statFile.mockResolvedValue(200);
    ipc.readTextFile.mockResolvedValue({ content: "# two", mtime_ms: 200 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(ipc.readTextFile).toHaveBeenCalledTimes(2);
    expect(result.current.content).toBe("# two");
  });

  it("exposes read errors and keeps the last content, then recovers", async () => {
    const { result } = renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();

    ipc.statFile.mockRejectedValue(new Error("gone"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.content).toBe("# one");
    expect(result.current.error).toContain("gone");

    ipc.statFile.mockResolvedValue(300);
    ipc.readTextFile.mockResolvedValue({ content: "# back", mtime_ms: 300 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current).toEqual({ content: "# back", error: null });
  });

  it("surfaces an initial load failure as an error with no content", async () => {
    ipc.readTextFile.mockRejectedValue(new Error("No such file"));
    const { result } = renderHook(() => useMarkdownFile("/tmp/missing.md"));
    await flush();
    expect(result.current.content).toBeNull();
    expect(result.current.error).toContain("No such file");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/hooks/useMarkdownFile.test.ts`
Expected: FAIL — cannot find module `./useMarkdownFile`.

- [ ] **Step 4: Implement the hook**

```ts
// src/hooks/useMarkdownFile.ts
import { useState, useEffect } from "react";
import { readTextFile, statFile } from "../lib/ipc";

const POLL_MS = 2000;

export interface MarkdownFileState {
  content: string | null;
  error: string | null;
}

/**
 * Loads a text file and keeps it fresh: polls the file's mtime every POLL_MS
 * and re-reads only when it changed — so a plan file Claude rewrites shows up
 * here on its own. A failing poll (file briefly missing mid-rewrite) keeps the
 * last content, shows the error, and keeps polling so it recovers by itself.
 */
export function useMarkdownFile(path: string | null): MarkdownFileState {
  const [state, setState] = useState<MarkdownFileState>({
    content: null,
    error: null,
  });

  useEffect(() => {
    setState({ content: null, error: null });
    if (!path) return;

    let cancelled = false;
    let mtime = 0;

    const load = async () => {
      try {
        const file = await readTextFile(path);
        if (cancelled) return;
        mtime = file.mtime_ms;
        setState({ content: file.content, error: null });
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({ content: prev.content, error: String(e) }));
      }
    };

    load();
    const timer = setInterval(async () => {
      try {
        const current = await statFile(path);
        if (cancelled || current === mtime) return;
        await load();
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({ content: prev.content, error: String(e) }));
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path]);

  return state;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/hooks/useMarkdownFile.test.ts && npx tsc --noEmit`
Expected: 6 passed; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ipc.ts src/hooks/useMarkdownFile.ts src/hooks/useMarkdownFile.test.ts
git commit -m "$(cat <<'EOF'
feat(mdviewer): useMarkdownFile hook — load + mtime-poll auto-reload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 9: Extract `PaneHeader` from NoteCell

**Files:**
- Create: `src/components/terminal/PaneHeader.tsx`
- Modify: `src/components/terminal/NoteCell.tsx`

**Interfaces:**
- Produces (used by NoteCell now, MarkdownViewerCell/PomodoroCell in Tasks 10/12):

```ts
interface PaneHeaderProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  isActive: boolean;
  workspaceId: string;
  workspaces: Workspace[];
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onMove: (workspaceId: string) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
}
```

- [ ] **Step 1: Create PaneHeader**

`src/components/terminal/PaneHeader.tsx` — the header chrome currently duplicated in NoteCell (rename-in-place, move menu, close button, drag handle, context-menu-to-move), parameterized by icon:

```tsx
import { useState, useCallback } from "react";
import type React from "react";
import { X, Pencil, Check } from "lucide-react";
import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";
import type { Workspace } from "../../types/terminal";

interface PaneHeaderProps {
  icon: React.ReactNode;
  label: string;
  color: string;
  isActive: boolean;
  workspaceId: string;
  workspaces: Workspace[];
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onMove: (workspaceId: string) => void;
  /**
   * When provided (canvas mode), the header acts as a drag handle. Pointer-downs
   * that don't originate on an interactive control are forwarded here so the
   * canvas can move the cell.
   */
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
}

/**
 * Shared header chrome for non-terminal canvas panes: drag handle, icon,
 * rename-in-place, move-to-workspace menu, close. TerminalCell keeps its own
 * header (status dot, context pill) — this covers the simpler pane kinds.
 */
export function PaneHeader({
  icon,
  label,
  color,
  isActive,
  workspaceId,
  workspaces,
  onSelect,
  onClose,
  onRename,
  onMove,
  onHeaderPointerDown,
}: PaneHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(label);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);

  const handleSubmitRename = useCallback(() => {
    if (editName.trim()) onRename(editName.trim());
    setEditing(false);
  }, [editName, onRename]);

  return (
    <div
      onPointerDown={onHeaderPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        setMoveMenuOpen(true);
      }}
      className={`group flex items-center gap-2 px-2 py-1 border-b select-none backdrop-blur-md ${
        onHeaderPointerDown && !editing ? "cursor-grab active:cursor-grabbing" : ""
      } ${
        isActive
          ? "border-accent-cyan/30 bg-accent-cyan/5"
          : "border-card-border bg-background-secondary/30"
      }`}
    >
      <span
        className="flex-shrink-0 flex items-center"
        style={{ color: isActive ? color : undefined }}
      >
        {icon}
      </span>

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
            style={{ color: isActive ? color : undefined }}
          >
            {label}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditName(label);
              setEditing(true);
            }}
            className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
          >
            <Pencil size={10} />
          </button>
        </>
      )}

      <MoveToWorkspaceMenu
        currentWorkspaceId={workspaceId}
        workspaces={workspaces}
        onMove={onMove}
        open={moveMenuOpen}
        onOpenChange={setMoveMenuOpen}
      />

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
  );
}
```

- [ ] **Step 2: Refactor NoteCell to use it**

Replace the entire contents of `src/components/terminal/NoteCell.tsx` with:

```tsx
import type React from "react";
import type { CSSProperties } from "react";
import { StickyNote } from "lucide-react";
import { PaneHeader } from "./PaneHeader";
import { NoteEditor } from "./NoteEditor";
import { useNoteContent } from "../../hooks/useNoteContent";
import type { NotePane } from "../../types/pane";
import type { Workspace } from "../../types/terminal";

interface NoteCellProps {
  note: NotePane;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
}

export function NoteCell({
  note,
  isActive,
  onSelect,
  onClose,
  onRename,
  onHeaderPointerDown,
  workspaces,
  onMove,
}: NoteCellProps) {
  const { loaded, initialContent, onChange } = useNoteContent(note.id);

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
      style={{ "--note-accent": note.color } as CSSProperties}
    >
      <PaneHeader
        icon={<StickyNote size={12} />}
        label={note.label}
        color={note.color}
        isActive={isActive}
        workspaceId={note.workspaceId}
        workspaces={workspaces}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onMove={onMove}
        onHeaderPointerDown={onHeaderPointerDown}
      />

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

(Note: this intentionally drops Task 3's older NoteCell edit — the accent style now lives on this new root. If Task 3's edit is already in place, this rewrite preserves it.)

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean and green.

```bash
git add src/components/terminal/PaneHeader.tsx src/components/terminal/NoteCell.tsx
git commit -m "$(cat <<'EOF'
refactor(panes): extract PaneHeader from NoteCell

Shared header chrome (drag, rename, move, close) for non-terminal panes,
ahead of the markdown viewer and pomodoro cells.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 10: MarkdownViewerCell + styles + wiring

**Files:**
- Modify: `package.json` (via npm install)
- Create: `src/components/terminal/MarkdownViewerCell.tsx`
- Modify: `src/components/terminal/TerminalCanvas.tsx` (render the mdviewer case)
- Modify: `src/components/terminal/TerminalGrid.tsx` (toolbar button)
- Modify: `src/styles/globals.css` (`.md-prose` styles)

**Interfaces:**
- Consumes: `useMarkdownFile` (Task 8), `PaneHeader` (Task 9), `MdViewerPane` type (Task 5), `onSetPanePath` threading (Task 6).

- [ ] **Step 1: Install renderer deps**

Run: `npm install react-markdown@^10.1.0 remark-gfm@^4.0.1`

- [ ] **Step 2: Create MarkdownViewerCell**

```tsx
// src/components/terminal/MarkdownViewerCell.tsx
import { useState, useEffect } from "react";
import type React from "react";
import { FileText, CircleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PaneHeader } from "./PaneHeader";
import { useMarkdownFile } from "../../hooks/useMarkdownFile";
import type { MdViewerPane } from "../../types/pane";
import type { Workspace } from "../../types/terminal";

interface MarkdownViewerCellProps {
  pane: MdViewerPane;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onSetPath: (path: string | null) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
}

/**
 * Read-only markdown file viewer. Paste an absolute path (e.g. a plan Claude
 * just wrote) and press Enter; the file renders and auto-reloads whenever it
 * changes on disk (mtime poll via useMarkdownFile).
 */
export function MarkdownViewerCell({
  pane,
  isActive,
  onSelect,
  onClose,
  onRename,
  onSetPath,
  onHeaderPointerDown,
  workspaces,
  onMove,
}: MarkdownViewerCellProps) {
  const [draft, setDraft] = useState(pane.path ?? "");
  const { content, error } = useMarkdownFile(pane.path);

  // Keep the input in sync if the path changes from outside (e.g. restore).
  useEffect(() => {
    setDraft(pane.path ?? "");
  }, [pane.path]);

  const commit = () => {
    const trimmed = draft.trim();
    onSetPath(trimmed === "" ? null : trimmed);
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
    >
      <PaneHeader
        icon={<FileText size={12} />}
        label={pane.label}
        color={pane.color}
        isActive={isActive}
        workspaceId={pane.workspaceId}
        workspaces={workspaces}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onMove={onMove}
        onHeaderPointerDown={onHeaderPointerDown}
      />

      {/* Path row */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-card-border bg-background-secondary/20">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          onBlur={commit}
          placeholder="/path/to/plan.md — paste and press Enter"
          spellCheck={false}
          className="flex-1 min-w-0 bg-white/5 border border-card-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-accent-cyan path-text"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {error && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">
          <CircleAlert size={12} className="flex-shrink-0" />
          <span className="truncate" title={error}>
            {error}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {content !== null ? (
          <div className="md-prose px-4 py-3 text-sm text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : !error ? (
          <div className="h-full flex items-center justify-center text-xs text-foreground-muted px-6 text-center">
            {pane.path
              ? "Loading…"
              : "Paste a markdown file path above — e.g. the plan Claude just wrote — and press Enter."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Render it on the canvas**

In `src/components/terminal/TerminalCanvas.tsx`, import it and replace the `: null` fallback for mdviewer:

```tsx
              ) : pane.kind === "mdviewer" ? (
                <MarkdownViewerCell
                  pane={pane}
                  isActive={isActive}
                  onSelect={() => onSelect(pane.id)}
                  onClose={() => onClosePane(pane.id)}
                  onRename={(label) => onRenamePane(pane.id, label)}
                  onSetPath={(path) => onSetPanePath(pane.id, path)}
                  onHeaderPointerDown={headerPointerDown}
                  workspaces={workspaces}
                  onMove={(wsId) => onMovePane(pane.id, wsId)}
                />
              ) : null /* pomodoro cell lands in Task 12 */}
```

- [ ] **Step 4: Toolbar button**

In `src/components/terminal/TerminalGrid.tsx`, import `FileText` from lucide-react and add next to the New-note button:

```tsx
          <button
            onClick={() => onNewPane("mdviewer")}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
            title="New plan viewer (markdown file)"
          >
            <FileText size={14} />
          </button>
```

- [ ] **Step 5: `.md-prose` styles**

Append to `src/styles/globals.css` after the note block:

```css
/* Markdown viewer pane (read-only render, consistent with .note-prose) */
.md-prose h1 { font-size: 1.35rem; font-weight: 700; margin: 0.8rem 0 0.3rem; }
.md-prose h2 { font-size: 1.15rem; font-weight: 650; margin: 0.7rem 0 0.25rem; }
.md-prose h3 { font-size: 1rem; font-weight: 600; margin: 0.55rem 0 0.2rem; }
.md-prose h4, .md-prose h5, .md-prose h6 { font-size: 0.9rem; font-weight: 600; margin: 0.5rem 0 0.15rem; }
.md-prose p { margin: 0.3rem 0; }
.md-prose ul { list-style: disc; padding-left: 1.25rem; margin: 0.25rem 0; }
.md-prose ol { list-style: decimal; padding-left: 1.25rem; margin: 0.25rem 0; }
.md-prose li { margin: 0.1rem 0; }
.md-prose li > input[type="checkbox"] { accent-color: #10b981; margin-right: 0.35rem; }
.md-prose a { color: var(--accent-cyan, #06b6d4); text-decoration: underline; text-underline-offset: 2px; }
.md-prose blockquote {
  border-left: 2px solid rgba(148, 163, 184, 0.4);
  padding-left: 0.75rem;
  margin: 0.4rem 0;
  color: var(--foreground-muted);
}
.md-prose hr { border: none; border-top: 1px solid rgba(148, 163, 184, 0.25); margin: 0.75rem 0; }
.md-prose code {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 0.85em;
  background: rgba(148, 163, 184, 0.15);
  border-radius: 0.25rem;
  padding: 0.05rem 0.3rem;
}
.md-prose pre {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.5rem;
  padding: 0.6rem 0.8rem;
  margin: 0.4rem 0;
  overflow-x: auto;
}
.md-prose pre code { background: none; padding: 0; }
.md-prose table { border-collapse: collapse; margin: 0.4rem 0; font-size: 0.85em; }
.md-prose th, .md-prose td {
  border: 1px solid rgba(148, 163, 184, 0.25);
  padding: 0.25rem 0.6rem;
  text-align: left;
}
.md-prose th { background: rgba(148, 163, 184, 0.1); font-weight: 600; }
```

(If `--accent-cyan` isn't defined as a CSS variable, the `#06b6d4` fallback in the `a` rule covers it.)

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean and green.

```bash
git add -A src package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(mdviewer): markdown plan viewer pane with auto-reload

Paste a .md path (e.g. a plan Claude wrote) into a new canvas pane; it
renders with GFM support and refreshes itself when the file changes on
disk. Path persists across restarts.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Part 4 — Pomodoro pane

### Task 11: Pomodoro clock logic

**Files:**
- Create: `src/lib/pomodoro.ts`
- Test: `src/lib/pomodoro.test.ts`

**Interfaces:**
- Produces (used by Task 12's cell): everything below, exactly as typed.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pomodoro.test.ts
import { describe, it, expect } from "vitest";
import { idleState, start, pause, reset, remaining, tick, minutesToMs } from "./pomodoro";

const T0 = 1_000_000; // arbitrary epoch ms

describe("pomodoro clock", () => {
  it("idles at the full focus duration", () => {
    const s = idleState(25);
    expect(s.phase).toBe("focus");
    expect(s.endsAt).toBeNull();
    expect(s.remainingMs).toBe(minutesToMs(25));
    expect(s.cycles).toBe(0);
    expect(remaining(s, T0)).toBe(minutesToMs(25));
  });

  it("start sets endsAt from remaining; remaining derives from the clock", () => {
    const s = start(idleState(25), T0);
    expect(s.endsAt).toBe(T0 + minutesToMs(25));
    expect(remaining(s, T0 + 60_000)).toBe(minutesToMs(25) - 60_000);
  });

  it("pause freezes remaining; resume continues from there", () => {
    let s = start(idleState(25), T0);
    s = pause(s, T0 + 5 * 60_000);
    expect(s.endsAt).toBeNull();
    expect(s.remainingMs).toBe(minutesToMs(20));
    s = start(s, T0 + 60 * 60_000); // resume an hour later
    expect(remaining(s, T0 + 60 * 60_000)).toBe(minutesToMs(20));
  });

  it("start and pause are no-ops when already in that state", () => {
    const idle = idleState(25);
    expect(pause(idle, T0)).toBe(idle);
    const running = start(idle, T0);
    expect(start(running, T0 + 1)).toBe(running);
  });

  it("tick before the deadline changes nothing", () => {
    const s = start(idleState(25), T0);
    const { state, completed } = tick(s, T0 + 1000, 25, 5);
    expect(completed).toBeNull();
    expect(state).toBe(s);
  });

  it("focus completion flips to a paused break and bumps cycles", () => {
    const s = start(idleState(25), T0);
    const { state, completed } = tick(s, T0 + minutesToMs(25), 25, 5);
    expect(completed).toBe("focus");
    expect(state.phase).toBe("break");
    expect(state.endsAt).toBeNull();
    expect(state.remainingMs).toBe(minutesToMs(5));
    expect(state.cycles).toBe(1);
  });

  it("break completion flips back to a paused focus without bumping cycles", () => {
    const afterFocus = tick(start(idleState(25), T0), T0 + minutesToMs(25), 25, 5).state;
    const runningBreak = start(afterFocus, T0);
    const { state, completed } = tick(runningBreak, T0 + minutesToMs(5), 25, 5);
    expect(completed).toBe("break");
    expect(state.phase).toBe("focus");
    expect(state.endsAt).toBeNull();
    expect(state.remainingMs).toBe(minutesToMs(25));
    expect(state.cycles).toBe(1);
  });

  it("reset returns to an idle focus phase but keeps the cycle tally", () => {
    const afterFocus = tick(start(idleState(25), T0), T0 + minutesToMs(25), 25, 5).state;
    const s = reset(afterFocus, 25);
    expect(s.phase).toBe("focus");
    expect(s.remainingMs).toBe(minutesToMs(25));
    expect(s.cycles).toBe(1);
  });

  it("remaining never goes negative", () => {
    const s = start(idleState(25), T0);
    expect(remaining(s, T0 + minutesToMs(26))).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/pomodoro.test.ts`
Expected: FAIL — cannot find module `./pomodoro`.

- [ ] **Step 3: Implement**

```ts
// src/lib/pomodoro.ts
export type PomodoroPhase = "focus" | "break";

export interface PomodoroState {
  phase: PomodoroPhase;
  /** Epoch ms when the running phase ends; null while paused/idle. */
  endsAt: number | null;
  /** Ms left in the phase; authoritative only while paused/idle. */
  remainingMs: number;
  /** Completed focus sessions (the cycle tally). */
  cycles: number;
}

export const minutesToMs = (m: number) => Math.round(m * 60_000);

export function idleState(workMinutes: number): PomodoroState {
  return {
    phase: "focus",
    endsAt: null,
    remainingMs: minutesToMs(workMinutes),
    cycles: 0,
  };
}

export function start(s: PomodoroState, now: number): PomodoroState {
  if (s.endsAt !== null) return s;
  return { ...s, endsAt: now + s.remainingMs };
}

export function pause(s: PomodoroState, now: number): PomodoroState {
  if (s.endsAt === null) return s;
  return { ...s, endsAt: null, remainingMs: Math.max(0, s.endsAt - now) };
}

export function reset(s: PomodoroState, workMinutes: number): PomodoroState {
  return { ...idleState(workMinutes), cycles: s.cycles };
}

/** Ms left in the current phase. Derives from the wall clock while running, so
 * interval throttling can never drift the countdown. */
export function remaining(s: PomodoroState, now: number): number {
  return s.endsAt === null ? s.remainingMs : Math.max(0, s.endsAt - now);
}

/**
 * Advance the clock. When the running phase has ended, flip to the other
 * phase — paused at its full duration (no surprise auto-start) — and report
 * which phase completed so the caller can play a sound / notify. Completing a
 * focus phase bumps the cycle tally.
 */
export function tick(
  s: PomodoroState,
  now: number,
  workMinutes: number,
  breakMinutes: number
): { state: PomodoroState; completed: PomodoroPhase | null } {
  if (s.endsAt === null || now < s.endsAt) return { state: s, completed: null };
  if (s.phase === "focus") {
    return {
      state: {
        phase: "break",
        endsAt: null,
        remainingMs: minutesToMs(breakMinutes),
        cycles: s.cycles + 1,
      },
      completed: "focus",
    };
  }
  return {
    state: {
      phase: "focus",
      endsAt: null,
      remainingMs: minutesToMs(workMinutes),
      cycles: s.cycles,
    },
    completed: "break",
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/pomodoro.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pomodoro.ts src/lib/pomodoro.test.ts
git commit -m "$(cat <<'EOF'
feat(pomodoro): wall-clock pomodoro state machine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 12: PomodoroCell + wiring + wrap-up

**Files:**
- Create: `src/components/terminal/PomodoroCell.tsx`
- Modify: `src/components/terminal/TerminalCanvas.tsx` (render the pomodoro case)
- Modify: `src/components/terminal/TerminalGrid.tsx` (toolbar button)
- Modify: `docs/superpowers/specs/2026-07-05-note-glowup-and-new-panes-design.md` (status line)

**Interfaces:**
- Consumes: Task 11's clock, `PaneHeader` (Task 9), `PomodoroPane` type (Task 5), `onSetPomodoroDurations` threading (Task 6), `useSounds` (`play("ding")`), `useNotifications` (`notify(title, body)`).

- [ ] **Step 1: Create PomodoroCell**

```tsx
// src/components/terminal/PomodoroCell.tsx
import { useState, useEffect } from "react";
import type React from "react";
import { Timer, Play, Pause as PauseIcon, RotateCcw } from "lucide-react";
import { PaneHeader } from "./PaneHeader";
import { useSounds } from "../../hooks/useSounds";
import { useNotifications } from "../../hooks/useNotifications";
import {
  idleState,
  start,
  pause,
  reset,
  remaining,
  tick,
  minutesToMs,
  type PomodoroState,
} from "../../lib/pomodoro";
import type { PomodoroPane } from "../../types/pane";
import type { Workspace } from "../../types/terminal";

interface PomodoroCellProps {
  pane: PomodoroPane;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onSetDurations: (workMinutes: number, breakMinutes: number) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
}

const RING_R = 54;
const RING_CIRC = 2 * Math.PI * RING_R;
const FOCUS_COLOR = "#10b981";
const BREAK_COLOR = "#06b6d4";

function fmt(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clampMinutes(v: number): number {
  return Math.min(180, Math.max(1, Math.round(v) || 1));
}

/**
 * Pomodoro timer pane. The countdown derives from a stored end timestamp, so
 * re-renders, workspace switches, and interval throttling can't drift it.
 * Phase completion plays a ding and fires an OS notification, then waits —
 * the next phase never auto-starts. Timer state is runtime-only; the pane's
 * durations persist.
 */
export function PomodoroCell({
  pane,
  isActive,
  onSelect,
  onClose,
  onRename,
  onSetDurations,
  onHeaderPointerDown,
  workspaces,
  onMove,
}: PomodoroCellProps) {
  const [state, setState] = useState<PomodoroState>(() => idleState(pane.workMinutes));
  const [, setDisplayTick] = useState(0);
  const { play } = useSounds();
  const { notify } = useNotifications();

  const running = state.endsAt !== null;

  // Drive the countdown display and detect phase completion while running.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const { state: next, completed } = tick(state, now, pane.workMinutes, pane.breakMinutes);
      if (completed) {
        setState(next);
        play("ding");
        notify(
          completed === "focus" ? "Focus session complete" : "Break over",
          completed === "focus" ? "Time for a break." : "Back to focus."
        ).catch(console.error);
      } else {
        setDisplayTick((t) => t + 1);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [running, state, pane.workMinutes, pane.breakMinutes, play, notify]);

  const now = Date.now();
  const left = remaining(state, now);
  const phaseTotal = minutesToMs(state.phase === "focus" ? pane.workMinutes : pane.breakMinutes);
  const frac = phaseTotal === 0 ? 0 : left / phaseTotal;
  const ringColor = state.phase === "focus" ? FOCUS_COLOR : BREAK_COLOR;
  const filledDots = state.cycles === 0 ? 0 : ((state.cycles - 1) % 4) + 1;

  const changeDurations = (workMinutes: number, breakMinutes: number) => {
    onSetDurations(workMinutes, breakMinutes);
    // Changing durations restarts the clock at the new focus length (cycle
    // tally survives) — predictable, and only reachable while paused.
    setState((s) => ({ ...idleState(workMinutes), cycles: s.cycles }));
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
    >
      <PaneHeader
        icon={<Timer size={12} />}
        label={pane.label}
        color={pane.color}
        isActive={isActive}
        workspaceId={pane.workspaceId}
        workspaces={workspaces}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onMove={onMove}
        onHeaderPointerDown={onHeaderPointerDown}
      />

      <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center gap-3 py-4">
        {/* Ring countdown */}
        <div className="relative w-36 h-36">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r={RING_R}
              fill="none"
              stroke="rgba(148, 163, 184, 0.15)"
              strokeWidth="6"
            />
            <circle
              cx="60"
              cy="60"
              r={RING_R}
              fill="none"
              stroke={ringColor}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={RING_CIRC * (1 - frac)}
              style={{ transition: "stroke-dashoffset 250ms linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {fmt(left)}
            </span>
            <span
              className="text-[10px] uppercase tracking-widest"
              style={{ color: ringColor }}
            >
              {state.phase === "focus" ? "Focus" : "Break"}
            </span>
          </div>
        </div>

        {/* Cycle tally */}
        <div className="flex items-center gap-1.5" title={`${state.cycles} focus sessions done`}>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: i < filledDots ? FOCUS_COLOR : "rgba(148, 163, 184, 0.25)",
              }}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {running ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setState((s) => pause(s, Date.now()));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-foreground hover:bg-white/10 text-xs font-medium"
            >
              <PauseIcon size={12} />
              Pause
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setState((s) => start(s, Date.now()));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-medium"
            >
              <Play size={12} />
              Start
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setState((s) => reset(s, pane.workMinutes));
            }}
            className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-white/5"
            title="Reset"
          >
            <RotateCcw size={12} />
          </button>
        </div>

        {/* Durations (editable while paused) */}
        {!running && (
          <div className="flex items-center gap-3 text-xs text-foreground-muted">
            <label className="flex items-center gap-1.5">
              Focus
              <input
                type="number"
                min={1}
                max={180}
                value={pane.workMinutes}
                onChange={(e) =>
                  changeDurations(clampMinutes(Number(e.target.value)), pane.breakMinutes)
                }
                onClick={(e) => e.stopPropagation()}
                className="w-14 bg-white/5 border border-card-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent-cyan tabular-nums"
              />
              min
            </label>
            <label className="flex items-center gap-1.5">
              Break
              <input
                type="number"
                min={1}
                max={180}
                value={pane.breakMinutes}
                onChange={(e) =>
                  changeDurations(pane.workMinutes, clampMinutes(Number(e.target.value)))
                }
                onClick={(e) => e.stopPropagation()}
                className="w-14 bg-white/5 border border-card-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent-cyan tabular-nums"
              />
              min
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the canvas**

In `src/components/terminal/TerminalCanvas.tsx`, import `PomodoroCell` and replace the remaining `: null` fallback:

```tsx
              ) : (
                <PomodoroCell
                  pane={pane}
                  isActive={isActive}
                  onSelect={() => onSelect(pane.id)}
                  onClose={() => onClosePane(pane.id)}
                  onRename={(label) => onRenamePane(pane.id, label)}
                  onSetDurations={(w, b) => onSetPomodoroDurations(pane.id, w, b)}
                  onHeaderPointerDown={headerPointerDown}
                  workspaces={workspaces}
                  onMove={(wsId) => onMovePane(pane.id, wsId)}
                />
              )}
```

(The final branch needs no `pane.kind === "pomodoro"` guard — after terminal/note/mdviewer, TypeScript narrows `pane` to `PomodoroPane`.)

- [ ] **Step 3: Toolbar button**

In `src/components/terminal/TerminalGrid.tsx`, import `Timer` from lucide-react and add next to the plan-viewer button:

```tsx
          <button
            onClick={() => onNewPane("pomodoro")}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
            title="New pomodoro timer"
          >
            <Timer size={14} />
          </button>
```

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npx vitest run && (cd src-tauri && cargo test)`
Expected: everything green.

- [ ] **Step 5: Mark the spec implemented and commit**

In `docs/superpowers/specs/2026-07-05-note-glowup-and-new-panes-design.md`, change the Status line to:

```markdown
**Status:** Implemented (plan: docs/superpowers/plans/2026-07-05-note-glowup-and-new-panes.md)
```

```bash
git add -A src docs
git commit -m "$(cat <<'EOF'
feat(pomodoro): pomodoro timer pane with ring countdown

Wall-clock-driven focus/break timer as a canvas pane: green focus ring,
cyan break ring, cycle tally, ding + OS notification on phase end, and
persisted durations. Completes the note-glowup/new-panes spec.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- Task 5 deliberately has no standalone commit: it renames a hook out from under App.tsx, so Tasks 5+6 land as one commit to keep `main` green. Their test cycles are still separate.
- `useEditorState` (Task 2) is verified present in the installed `@tiptap/react@3.27.1`; `Placeholder` is verified exported by `@tiptap/extensions` (already installed transitively; promoted to a direct dep).
- The mdviewer/pomodoro `null` fallbacks in Task 6 are unreachable at runtime (no UI can create those kinds until their toolbar buttons land in Tasks 10/12) and are eliminated by Tasks 10 and 12.
- Reused APIs verified against the codebase: `resolve_path` (system.rs:31), `play("ding")` (`SoundName` includes `"ding"`), `notify(title, body)` (useNotifications.ts:23), `PROJECT_COLORS`/`generateId` (as in the old useNotes).
