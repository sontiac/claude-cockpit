# Quick UI Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the three top bars into two (workspace tabs + window controls on top, buttons bar below), make the sidebar hideable with edge-hover reveal and a persisted pin, and show live per-project terminal counts with full-name tooltips.

**Architecture:** A new `TopBar` component replaces `TitleBar` + `WorkspaceBar` (both deleted, no shims). A new `SidebarReveal` wrapper renders the sidebar either docked (pinned) or as an edge-hover overlay (unpinned, the default). The pinned flag persists inside the existing per-window `WindowState` (Rust `workspace/store.rs` + `useTerminals`' save/load), which is the single writer of that file. Counts are a pure function over the window's live terminals.

**Tech Stack:** Tauri v2 (Rust), React 19 + TypeScript, Tailwind 4, Vitest + Testing Library (jsdom, `globals: true`), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-08-03-quick-ui-batch-design.md`

## Global Constraints

- NO hacks, workarounds, or compatibility shims. Replaced components are deleted outright (repo is not in production; backwards compatibility is explicitly unimportant).
- Every task ends with `npm test` passing and, when Rust changed, `cargo check --manifest-path src-tauri/Cargo.toml` clean.
- `npm run build` runs `tsc` — it must pass at the end of any task that changes TypeScript.
- Match existing idioms: Tailwind utility classes, `text-foreground-muted` palette, lucide icons at size 13–15, `data-nodrag` opt-out for draggable chrome, tests colocated next to the source file.
- All commands run from the repo root: `/Users/kshortrede/Documents/ByteFederal/claude-cockpit`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Per-project terminal count function

**Files:**
- Create: `src/lib/projectCounts.ts`
- Test: `src/lib/projectCounts.test.ts`

**Interfaces:**
- Consumes: nothing (pure function; parameter is structurally typed so it accepts `TerminalInfo[]`).
- Produces: `countTerminalsByProject(terminals: ReadonlyArray<{ project_id: string | null }>): Map<string, number>` — used by `App.tsx` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/lib/projectCounts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countTerminalsByProject } from "./projectCounts";

describe("countTerminalsByProject", () => {
  it("counts terminals grouped by project id", () => {
    const terminals = [
      { project_id: "a" },
      { project_id: "b" },
      { project_id: "a" },
      { project_id: "a" },
    ];
    const counts = countTerminalsByProject(terminals);
    expect(counts.get("a")).toBe(3);
    expect(counts.get("b")).toBe(1);
  });

  it("ignores terminals without a project", () => {
    const counts = countTerminalsByProject([
      { project_id: null },
      { project_id: "a" },
    ]);
    expect(counts.size).toBe(1);
    expect(counts.get("a")).toBe(1);
  });

  it("returns an empty map for no terminals", () => {
    expect(countTerminalsByProject([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projectCounts.test.ts`
Expected: FAIL — cannot resolve `./projectCounts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/projectCounts.ts`:

```ts
/**
 * Live terminal count per project for one window. Counts terminal panes only —
 * canvas panes (notes, plan viewers, timers) have no project association.
 */
export function countTerminalsByProject(
  terminals: ReadonlyArray<{ project_id: string | null }>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of terminals) {
    if (!t.project_id) continue;
    counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
  }
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projectCounts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/projectCounts.ts src/lib/projectCounts.test.ts
git commit -m "feat(sidebar): pure per-project terminal count function

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Persist `sidebar_pinned` in WindowState

**Files:**
- Modify: `src-tauri/src/workspace/store.rs:46-56` (WindowState struct; add tests module at end of file)
- Modify: `src/types/terminal.ts:47-52` (WindowState interface)
- Modify: `src/hooks/useTerminals.ts` (state, load, persist, toggle, discard)

**Interfaces:**
- Consumes: existing `getWindowState`/`saveWindowState` IPC wrappers in `src/lib/ipc.ts` (signatures unchanged — the `WindowState` payload just gains a field).
- Produces: `useTerminals()` return value gains `sidebarPinned: boolean` and `toggleSidebarPinned: () => void` — used by `App.tsx` in Task 4.

- [ ] **Step 1: Write the failing Rust test**

At the end of `src-tauri/src/workspace/store.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Old on-disk snapshots predate the field; they must load as unpinned
    /// (hidden), the spec'd default.
    #[test]
    fn window_state_without_sidebar_pinned_defaults_to_false() {
        let json = r#"{"workspaces":[],"terminals":[],"active_workspace_id":null,"geometry":null}"#;
        let state: WindowState = serde_json::from_str(json).unwrap();
        assert!(!state.sidebar_pinned);
    }

    #[test]
    fn window_state_round_trips_sidebar_pinned() {
        let state = WindowState {
            sidebar_pinned: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&state).unwrap();
        let back: WindowState = serde_json::from_str(&json).unwrap();
        assert!(back.sidebar_pinned);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sidebar_pinned`
Expected: FAIL to compile — `WindowState` has no field `sidebar_pinned`.

- [ ] **Step 3: Add the field to the Rust struct**

In `src-tauri/src/workspace/store.rs`, extend `WindowState` (keep existing fields; add the new one after `geometry`):

```rust
/// The full persisted state for one window: its workspaces, the terminals open
/// in each, which workspace was active, and where the window sat on screen.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WindowState {
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub terminals: Vec<PersistedTerminal>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub geometry: Option<Geometry>,
    /// Whether the sidebar is pinned (docked). Unpinned sidebars hide and
    /// reveal on left-edge hover. Defaults to false (hidden).
    #[serde(default)]
    pub sidebar_pinned: bool,
}
```

- [ ] **Step 4: Run Rust tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sidebar_pinned`
Expected: PASS (2 tests).

- [ ] **Step 5: Mirror the field in the TS type**

In `src/types/terminal.ts`, extend `WindowState`:

```ts
/** The full persisted state for one window (keyed by window label on disk). */
export interface WindowState {
  workspaces: Workspace[];
  terminals: PersistedTerminal[];
  active_workspace_id: string | null;
  geometry: Geometry | null;
  /** Sidebar docked (pinned) vs hidden-with-edge-hover. Default false. */
  sidebar_pinned: boolean;
}
```

Note: `src/lib/ipc.ts` types `saveWindowState`/`getWindowState` against this interface — no change needed there, but the compiler will now force every construction site of `WindowState` to include the field (that's Step 6).

- [ ] **Step 6: Wire the flag through `useTerminals`**

In `src/hooks/useTerminals.ts`, four edits:

1. Add state next to the workspace state (after the `activeWorkspaceId` declaration, ~line 78):

```ts
// Sidebar docked (pinned) vs hidden-with-edge-hover. Persisted per window.
const [sidebarPinned, setSidebarPinned] = useState(false);
```

2. In the startup effect, right after `setActiveWorkspaceId(active);` (~line 305):

```ts
setSidebarPinned(state.sidebar_pinned);
```

3. In the persist effect (~line 416), include the field in the saved object and add it to the dependency array:

```ts
saveWindowState(WINDOW_LABEL, {
  workspaces,
  terminals: terminals.map(toPersisted),
  active_workspace_id: activeWorkspaceId,
  geometry,
  sidebar_pinned: sidebarPinned,
}).catch((error) => console.error("Failed to persist window:", error));
```

```ts
}, [terminals, workspaces, activeWorkspaceId, persistArmed, geometryVersion, sidebarPinned]);
```

4. In `discard` (~line 379), reset alongside the workspace reset: add `setSidebarPinned(false);` after `setActiveId(null);`. Then add the toggle callback (next to `reorderWorkspaces`) and export both:

```ts
const toggleSidebarPinned = useCallback(() => {
  setSidebarPinned((p) => !p);
}, []);
```

In the returned object, add `sidebarPinned` and `toggleSidebarPinned`.

- [ ] **Step 7: Verify everything compiles and passes**

Run: `npm run build && npm test && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: all pass. (`App.tsx` doesn't consume the new fields yet — unused hook returns are fine.)

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/workspace/store.rs src/types/terminal.ts src/hooks/useTerminals.ts
git commit -m "feat(sidebar): persist per-window sidebar_pinned in WindowState

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: SidebarReveal component (edge hover + pin modes)

**Files:**
- Create: `src/components/layout/SidebarReveal.tsx`
- Test: `src/components/layout/SidebarReveal.test.tsx`

**Interfaces:**
- Consumes: nothing project-specific (pure React).
- Produces: `SidebarReveal({ pinned: boolean, children: ReactNode })` — used by `App.tsx` in Task 4. Requires its parent to be `position: relative`; the overlay and hot strip are absolutely positioned within it. Test ids `sidebar-hot-strip` and `sidebar-flyout` exist on the unpinned-mode elements.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/SidebarReveal.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SidebarReveal } from "./SidebarReveal";

describe("SidebarReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders children directly when pinned (no hot strip, no flyout)", () => {
    render(
      <SidebarReveal pinned>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    expect(screen.getByText("sidebar content")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-hot-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-flyout")).not.toBeInTheDocument();
  });

  it("starts hidden when unpinned and opens on hot-strip hover", () => {
    render(
      <SidebarReveal pinned={false}>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    const flyout = screen.getByTestId("sidebar-flyout");
    expect(flyout.className).toContain("-translate-x-full");

    fireEvent.mouseEnter(screen.getByTestId("sidebar-hot-strip"), { buttons: 0 });
    expect(flyout.className).toContain("translate-x-0");
  });

  it("does not open while a mouse button is held (pane drag in progress)", () => {
    render(
      <SidebarReveal pinned={false}>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    fireEvent.mouseEnter(screen.getByTestId("sidebar-hot-strip"), { buttons: 1 });
    expect(screen.getByTestId("sidebar-flyout").className).toContain(
      "-translate-x-full"
    );
  });

  it("closes after the delay on mouse leave, and re-enter cancels the close", () => {
    render(
      <SidebarReveal pinned={false}>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    const strip = screen.getByTestId("sidebar-hot-strip");
    const flyout = screen.getByTestId("sidebar-flyout");

    fireEvent.mouseEnter(strip, { buttons: 0 });
    fireEvent.mouseLeave(flyout);
    // Still open before the delay elapses.
    act(() => vi.advanceTimersByTime(200));
    expect(flyout.className).toContain("translate-x-0");

    // Re-enter cancels the pending close.
    fireEvent.mouseEnter(flyout);
    act(() => vi.advanceTimersByTime(500));
    expect(flyout.className).toContain("translate-x-0");

    // Leave again and let the delay elapse: closed.
    fireEvent.mouseLeave(flyout);
    act(() => vi.advanceTimersByTime(500));
    expect(flyout.className).toContain("-translate-x-full");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/SidebarReveal.test.tsx`
Expected: FAIL — cannot resolve `./SidebarReveal`.

- [ ] **Step 3: Write the implementation**

Create `src/components/layout/SidebarReveal.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface SidebarRevealProps {
  /** Docked mode: render children in normal flow, exactly as before. */
  pinned: boolean;
  children: ReactNode;
}

/** How long the overlay lingers after the pointer leaves, so brief exits
 *  (e.g. overshooting a button) don't flicker it closed. */
const CLOSE_DELAY_MS = 300;

/**
 * Renders the sidebar docked when pinned. When unpinned, the sidebar hides
 * entirely; a thin hot strip on the left edge slides it in as an overlay above
 * the canvas. The parent container must be `position: relative` — both the hot
 * strip and the overlay position against it.
 */
export function SidebarReveal({ pinned, children }: SidebarRevealProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };

  // Pinning while the overlay is open must not leave a stale timer or state.
  useEffect(() => {
    if (pinned) {
      cancelClose();
      setOpen(false);
    }
  }, [pinned]);

  useEffect(() => cancelClose, []);

  if (pinned) return <>{children}</>;

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <>
      {/* Hot strip. `buttons === 0` keeps it inert while any mouse button is
          held, so dragging a pane toward the left edge never pops the overlay. */}
      <div
        data-testid="sidebar-hot-strip"
        className="absolute left-0 top-0 bottom-0 w-1.5 z-40"
        onMouseEnter={(e) => {
          if (e.buttons === 0) {
            cancelClose();
            setOpen(true);
          }
        }}
      />
      <div
        data-testid="sidebar-flyout"
        className={`absolute left-0 top-0 bottom-0 z-50 shadow-2xl transition-transform duration-150 ${
          open ? "translate-x-0" : "-translate-x-full pointer-events-none"
        }`}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        {children}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/layout/SidebarReveal.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/SidebarReveal.tsx src/components/layout/SidebarReveal.test.tsx
git commit -m "feat(sidebar): SidebarReveal wrapper with edge-hover overlay mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Sidebar counts, tooltip, pin button + App integration

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/layout/Sidebar.test.tsx` (create)

**Interfaces:**
- Consumes: `countTerminalsByProject` (Task 1), `SidebarReveal` (Task 3), `sidebarPinned`/`toggleSidebarPinned` from `useTerminals` (Task 2).
- Produces: `SidebarProps` gains `terminalCounts: Map<string, number>`, `pinned: boolean`, `onTogglePin: () => void`. Cmd+B keyboard shortcut. No later task depends on this one.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { Project } from "../../types/project";

// Sidebar (and its ProviderMenu / session list) reach Tauri IPC on interaction;
// none of that runs in these render-level tests, but the imports must resolve
// without a Tauri runtime.
vi.mock("../../lib/ipc", () => ({
  getSessions: vi.fn(async () => []),
  setSessionStarred: vi.fn(async () => {}),
}));
vi.mock("../../hooks/useProviders", () => ({ useProviders: () => [] }));

const project: Project = {
  id: "p1",
  name: "My Very Long Project Name",
  path: "/tmp/p1",
  color: "#ff0000",
  terminals: 2,
  command: null,
};

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    projects: [project],
    terminalCounts: new Map<string, number>(),
    pinned: false,
    onTogglePin: vi.fn(),
    onLaunchProject: vi.fn(),
    onAddProject: vi.fn(),
    onEditProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onReorderProjects: vi.fn(),
    onNewTerminal: vi.fn(),
    onNewNote: vi.fn(),
    onResumeSession: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar", () => {
  it("shows the live terminal count next to the project name", () => {
    renderSidebar({ terminalCounts: new Map([["p1", 3]]) });
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("omits the count entirely when zero", () => {
    renderSidebar();
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
  });

  it("exposes the full project name as a native tooltip", () => {
    renderSidebar();
    expect(screen.getByTitle("My Very Long Project Name")).toBeInTheDocument();
  });

  it("fires onTogglePin from the pin button", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByTitle(/pin sidebar/i));
    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/Sidebar.test.tsx`
Expected: FAIL — TS/props errors (`terminalCounts` etc. not in `SidebarProps`) and missing elements.

- [ ] **Step 3: Extend `Sidebar.tsx`**

Four edits:

1. Add to the lucide import: `Pin, PinOff`.

2. Extend `SidebarProps`:

```ts
interface SidebarProps {
  projects: Project[];
  /** Live terminal count per project id for THIS window (zero-count ids absent). */
  terminalCounts: Map<string, number>;
  /** Docked (true) vs hidden-with-edge-hover (false). */
  pinned: boolean;
  onTogglePin: () => void;
  onLaunchProject: (project: Project, provider?: string) => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onReorderProjects: (orderedIds: string[]) => void;
  onNewTerminal: () => void;
  onNewNote: () => void;
  onResumeSession: (
    sessionId: string,
    cwd: string,
    label: string,
    provider?: string
  ) => void;
}
```

Destructure the three new props in the `Sidebar` function signature.

3. In `ProjectSection`, add a `terminalCount: number` prop (both to the inline props type and the destructuring), and replace the name `<div>` (currently `Sidebar.tsx:197-201`) with:

```tsx
<div className="flex-1 min-w-0">
  <div
    className="text-sm text-foreground truncate"
    title={project.name}
  >
    {project.name}
    {terminalCount > 0 && (
      <span className="ml-1.5 text-xs text-foreground-muted tabular-nums">
        ({terminalCount})
      </span>
    )}
  </div>
</div>
```

At the `<ProjectSection>` call site inside `Sidebar`, pass:

```tsx
terminalCount={terminalCounts.get(project.id) ?? 0}
```

4. Add the pin toggle at the top of the quick-actions block (first child of the `p-3 space-y-1` div, `Sidebar.tsx:347`):

```tsx
<div className="flex justify-end">
  <button
    onClick={onTogglePin}
    title={pinned ? "Unpin sidebar (Cmd+B)" : "Pin sidebar (Cmd+B)"}
    className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
  >
    {pinned ? <PinOff size={13} /> : <Pin size={13} />}
  </button>
</div>
```

- [ ] **Step 4: Wire everything in `App.tsx`**

Five edits:

1. Imports: add `SidebarReveal` and `countTerminalsByProject`:

```ts
import { SidebarReveal } from "./components/layout/SidebarReveal";
import { countTerminalsByProject } from "./lib/projectCounts";
```

2. Destructure `sidebarPinned, toggleSidebarPinned` from the existing `useTerminals()` call.

3. Add the counts memo next to `workspaceCounts` (~line 203):

```ts
// Live terminal count per project (this window only), for the sidebar rows.
const projectTerminalCounts = useMemo(
  () => countTerminalsByProject(terminals),
  [terminals]
);
```

4. Keyboard shortcut — inside the `metaKey || ctrlKey` block of `handleKeyDown` (after the `e.key === "0"` branch, ~line 183):

```ts
} else if (e.key === "b") {
  e.preventDefault();
  toggleSidebarPinned();
}
```

Add `toggleSidebarPinned` to the effect's dependency array.

5. In the JSX: the content row `<div className="flex flex-1 min-h-0">` (line 367) becomes `<div className="relative flex flex-1 min-h-0">` (the `SidebarReveal` overlay positions against it), and the `<Sidebar ... />` element is wrapped and given the new props:

```tsx
<SidebarReveal pinned={sidebarPinned}>
  <Sidebar
    projects={projects}
    terminalCounts={projectTerminalCounts}
    pinned={sidebarPinned}
    onTogglePin={toggleSidebarPinned}
    onLaunchProject={handleLaunchProject}
    onAddProject={() => setShowAddProject(true)}
    onEditProject={(project) => setEditProject(project)}
    onDeleteProject={async (project) => {
      const ok = await confirm({
        title: `Remove "${project.name}" from cockpit?`,
        body: "This only removes the project entry — your files and Claude sessions are untouched.",
        confirmLabel: "Remove",
      });
      if (!ok) return;
      removeProject(project.id);
      play("click");
    }}
    onReorderProjects={reorderProjects}
    onNewTerminal={() => handleNewTerminal()}
    onNewNote={() => handleNewPane("note")}
    onResumeSession={handleResumeSession}
  />
</SidebarReveal>
```

Note: `Sidebar`'s root already has its own width (`w-56`) and full height, so it renders correctly in both docked flow and the absolute flyout.

- [ ] **Step 5: Run the test suite and build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS, `tsc` clean.

- [ ] **Step 6: Manual verification**

Run: `npm run tauri dev`
Check: sidebar starts hidden (fresh field defaults false); left-edge hover slides it in; moving away closes it after a beat; pin button docks it; Cmd+B toggles; pin state survives an app restart; while dragging a pane to the left edge the overlay does NOT open; project rows show live `(n)` counts that update when terminals open/close; long project names show a hover tooltip.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/components/layout/Sidebar.test.tsx src/App.tsx
git commit -m "feat(sidebar): hideable sidebar with edge-hover reveal, live project counts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: TopBar — merge TitleBar and WorkspaceBar

**Files:**
- Create: `src/components/layout/TopBar.tsx`
- Delete: `src/components/layout/TitleBar.tsx`, `src/components/layout/WorkspaceBar.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/layout/TopBar.test.tsx` (create)

**Interfaces:**
- Consumes: `toggleMaximizeWindow` from `src/lib/ipc.ts`, `getCurrentWindow` from `@tauri-apps/api/window`, `Workspace` type.
- Produces: `TopBar` props = the former `WorkspaceBarProps` plus `onCloseWindow: () => void`. No later task depends on this one.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/TopBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopBar } from "./TopBar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(async () => {}),
    minimize: vi.fn(async () => {}),
  }),
}));
vi.mock("../../lib/ipc", () => ({
  toggleMaximizeWindow: vi.fn(async () => false),
}));

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    workspaces: [
      { id: "w1", name: "Workspace 1" },
      { id: "w2", name: "Workspace 2" },
    ],
    activeId: "w1",
    counts: { w1: 2 },
    paneCounts: {},
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onNewWindow: vi.fn(),
    onCloseWindow: vi.fn(),
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  it("renders one tab per workspace with live counts", () => {
    renderTopBar();
    expect(screen.getByText("Workspace 1")).toBeInTheDocument();
    expect(screen.getByText("Workspace 2")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // w1's count badge
  });

  it("switches workspace on tab click", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByText("Workspace 2"));
    expect(props.onSwitch).toHaveBeenCalledWith("w2");
  });

  it("creates a workspace from the + button", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByTitle("New workspace"));
    expect(props.onCreate).toHaveBeenCalled();
  });

  it("opens a new window and closes this one from the right cluster", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByTitle(/new window/i));
    expect(props.onNewWindow).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Close window"));
    expect(props.onCloseWindow).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/TopBar.test.tsx`
Expected: FAIL — cannot resolve `./TopBar`.

- [ ] **Step 3: Write `TopBar.tsx`**

Create `src/components/layout/TopBar.tsx`. The tab markup is carried over from `WorkspaceBar` verbatim (rename input, count badges, pane-count badge, delete button, HTML5 drag reorder); the drag-region and window-control logic from `TitleBar`:

```tsx
import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Plus,
  X,
  AppWindow,
  StickyNote,
  Minus,
  Square,
  Maximize2,
} from "lucide-react";
import { toggleMaximizeWindow } from "../../lib/ipc";
import type { Workspace } from "../../types/terminal";

interface TopBarProps {
  workspaces: Workspace[];
  activeId: string;
  counts: Record<string, number>;
  paneCounts: Record<string, { count: number; label: string }>;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onNewWindow: () => void;
  /** Close this window (App decides: close-just-this-window vs. quit the app). */
  onCloseWindow: () => void;
}

/**
 * The single chrome row at the top of a window: workspace tabs on the left,
 * a window-drag stretch in the middle, window controls on the right. Replaces
 * the old separate TitleBar + WorkspaceBar rows.
 */
export function TopBar({
  workspaces,
  activeId,
  counts,
  paneCounts,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onNewWindow,
  onCloseWindow,
}: TopBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Index of the tab being dragged and the tab currently hovered as a drop
  // target. Both reset to null when a drag ends.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const appWindow = getCurrentWindow();

  const handleMaximize = async () => {
    setIsMaximized(await toggleMaximizeWindow());
  };

  const beginRename = (ws: Workspace) => {
    setEditingId(ws.id);
    setDraft(ws.name);
  };
  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  const handleDrop = (toIndex: number) => {
    setOverIndex(null);
    const from = dragIndex;
    setDragIndex(null);
    if (from === null || from === toIndex) return;
    const next = workspaces.map((w) => w.id);
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    onReorder(next);
  };

  return (
    <div
      className="h-10 flex items-center gap-1 px-2 bg-background/30 backdrop-blur-2xl border-b border-white/10 select-none"
      onMouseDown={(e) => {
        // Only drag on the bar itself, not on tabs or buttons.
        if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
        if (e.buttons === 1) {
          appWindow.startDragging();
        }
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
        handleMaximize();
      }}
    >
      {/* Workspace tabs */}
      <div
        className="flex items-center gap-1 min-w-0 overflow-x-auto"
        data-nodrag
      >
        {workspaces.map((ws, index) => {
          const active = ws.id === activeId;
          const count = counts[ws.id] ?? 0;
          return (
            <div
              key={ws.id}
              onClick={() => onSwitch(ws.id)}
              onDoubleClick={() => beginRename(ws)}
              // A tab being renamed isn't draggable, so text selection inside
              // the input never starts a tab drag.
              draggable={editingId !== ws.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                // Firefox requires data to be set for a drag to start.
                e.dataTransfer.setData("text/plain", ws.id);
                setDragIndex(index);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== index) setOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(index);
              }}
              className={`group/ws flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg cursor-pointer flex-shrink-0 border transition-[background-color,border-color,opacity,transform] duration-150 ${
                active
                  ? "bg-white/10 border-white/15 text-foreground"
                  : "border-transparent text-foreground-muted hover:text-foreground hover:bg-white/5"
              } ${dragIndex === index ? "opacity-40" : ""} ${
                overIndex === index && dragIndex !== index
                  ? "ring-1 ring-accent-cyan/60 bg-accent-cyan/5 scale-105"
                  : ""
              }`}
              title="Double-click to rename — drag to reorder"
            >
              {editingId === ws.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={commitRename}
                  className="bg-white/10 border border-white/20 rounded px-1 py-0 text-xs text-foreground outline-none w-24"
                />
              ) : (
                <span className="text-xs font-medium whitespace-nowrap">
                  {ws.name}
                </span>
              )}
              {count > 0 && (
                <span
                  className={`text-[10px] tabular-nums px-1 rounded-full ${
                    active ? "bg-accent-cyan/20 text-accent-cyan" : "bg-white/5"
                  }`}
                >
                  {count}
                </span>
              )}
              {paneCounts[ws.id] && (
                <span
                  className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-foreground-muted"
                  title={paneCounts[ws.id].label}
                >
                  <StickyNote size={9} />
                  {paneCounts[ws.id].count}
                </span>
              )}
              {workspaces.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(ws.id);
                  }}
                  className="p-0.5 rounded text-foreground-muted/40 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/ws:opacity-100"
                  title="Delete workspace (terminals move to the first workspace)"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={onCreate}
          className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-white/5 flex-shrink-0"
          title="New workspace"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Window drag region */}
      <div className="flex-1 min-w-8 h-full" />

      {/* Window controls */}
      <div className="flex items-center gap-1" data-nodrag>
        <button
          onClick={onNewWindow}
          className="p-1.5 rounded-md hover:bg-white/10 text-foreground-muted hover:text-foreground"
          title="Open a new window (for a second monitor)"
        >
          <AppWindow size={14} />
        </button>
        <div className="w-px h-4 bg-card-border mx-1" />
        <button
          onClick={() => appWindow.minimize()}
          className="p-1.5 rounded-md hover:bg-white/10 text-foreground-muted hover:text-foreground"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1.5 rounded-md hover:bg-white/10 text-foreground-muted hover:text-foreground"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <Square size={12} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={onCloseWindow}
          className="p-1.5 rounded-md hover:bg-red-500/20 text-foreground-muted hover:text-red-400"
          title="Close window"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewire `App.tsx` and delete the old components**

1. Replace the `TitleBar` and `WorkspaceBar` imports with `import { TopBar } from "./components/layout/TopBar";`.
2. Replace `<TitleBar onClose={handleCloseWindow} />` (line 365) with:

```tsx
<TopBar
  workspaces={workspaces}
  activeId={activeWorkspaceId}
  counts={workspaceCounts}
  paneCounts={workspacePaneCounts}
  onSwitch={switchWorkspace}
  onCreate={createWorkspace}
  onRename={renameWorkspace}
  onDelete={handleDeleteWorkspace}
  onReorder={reorderWorkspaces}
  onNewWindow={() => openWindow().catch(console.error)}
  onCloseWindow={handleCloseWindow}
/>
```

3. Delete the entire `<WorkspaceBar ... />` element (lines 390-401) from the right column.
4. Delete the files:

```bash
git rm src/components/layout/TitleBar.tsx src/components/layout/WorkspaceBar.tsx
```

- [ ] **Step 5: Run the test suite and build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS, `tsc` clean (any remaining reference to the deleted components is a compile error — fix by removing it).

- [ ] **Step 6: Manual verification**

Run: `npm run tauri dev`
Check: exactly two bars above the canvas (tabs+controls, then buttons); dragging the empty middle stretch moves the window; double-click on it maximizes/restores; tab click/double-click-rename/drag-reorder/delete all work; `+` creates a workspace; new-window button opens a secondary window whose TopBar also works; ✕ on the last window prompts to quit, ✕ on a secondary window closes just that window.

- [ ] **Step 7: Commit**

```bash
git add -A src/components/layout src/App.tsx
git commit -m "feat(layout): merge titlebar and workspace bar into a single TopBar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

**Interfaces:** n/a.

- [ ] **Step 1: Run everything**

Run: `npx vitest run && npm run build && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all PASS/clean.

- [ ] **Step 2: End-to-end manual pass**

Run: `npm run tauri dev`
Walk the combined checklist from Tasks 4 and 5 once more in a single session, including: restart the app with a pinned sidebar and confirm it restores pinned; restart with it unpinned and confirm it stays hidden; confirm the restore-session prompt flow still works (quit with terminals open, relaunch, Recover).

- [ ] **Step 3: Report**

No commit. Report verification results honestly — if anything failed, it goes back to its task rather than being papered over.
