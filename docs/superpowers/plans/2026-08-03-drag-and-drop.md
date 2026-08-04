# Drag-and-Drop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable Tauri's native drag-drop (killing the drop-navigates-the-webview bug), migrate workspace-tab reorder off HTML5 dnd to pointer events, and make Finder file drops paste shell-escaped paths into the terminal pane under the cursor.

**Architecture:** Three independent pieces converge: a pure `shellQuote` helper, a pointer-gesture reorder hook (`useListReorder`, modeled on `TerminalCanvas.startGesture`'s window-listener pattern), and a per-window `useFileDrop` hook consuming `getCurrentWebview().onDragDropEvent`. The Tauri config flip happens only *after* the TopBar migration lands, so HTML5 dnd is never dead while still wired.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library (jsdom), Tauri v2 (`@tauri-apps/api` 2.10), Rust (cargo test).

**Spec:** `docs/superpowers/specs/2026-08-03-drag-and-drop-design.md` (as amended: sidebar reorder is menu-based; only TopBar tabs migrate).

## Global Constraints

- No HTML5 drag-and-drop may remain anywhere in `src/` when Task 4 (config flip) lands — wry swallows those DOM events once its handler is on.
- Multi-file drops paste **all** paths, space-separated, each shell-escaped, with **one trailing space**.
- Drops outside terminal panes are silent no-ops.
- Drag-over highlight is the existing cyan ring treatment (`ring-1 ring-accent-cyan/60`).
- Never launch or kill the production app; build only (`npm run tauri build`). The user smoke-tests drops themselves.
- Every task ends green: `npx tsc --noEmit && npm test` (and `cargo test` in `src-tauri/` for Rust-touching tasks).

---

### Task 1: `shellQuote` helper

**Files:**
- Create: `src/lib/shellQuote.ts`
- Test: `src/lib/shellQuote.test.ts`

**Interfaces:**
- Produces: `shellQuote(path: string): string` — POSIX-shell-safe quoting of one path. Task 6 consumes it.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/shellQuote.test.ts
import { describe, it, expect } from "vitest";
import { shellQuote } from "./shellQuote";

describe("shellQuote", () => {
  it("passes a plain absolute path through untouched", () => {
    expect(shellQuote("/Users/sontiac/Code/claude-cockpit/README.md")).toBe(
      "/Users/sontiac/Code/claude-cockpit/README.md"
    );
  });

  it("single-quotes a path containing spaces", () => {
    expect(shellQuote("/tmp/my file.txt")).toBe("'/tmp/my file.txt'");
  });

  it("escapes embedded single quotes with the '\\'' dance", () => {
    expect(shellQuote("/tmp/it's here.txt")).toBe("'/tmp/it'\\''s here.txt'");
  });

  it("quotes shell metacharacters", () => {
    expect(shellQuote("/tmp/a$b&c;d.txt")).toBe("'/tmp/a$b&c;d.txt'");
    expect(shellQuote("/tmp/(parens).txt")).toBe("'/tmp/(parens).txt'");
  });

  it("quotes non-ASCII paths", () => {
    expect(shellQuote("/tmp/café.txt")).toBe("'/tmp/café.txt'");
  });

  it("quotes the empty string", () => {
    expect(shellQuote("")).toBe("''");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/shellQuote.test.ts`
Expected: FAIL — cannot resolve `./shellQuote`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/shellQuote.ts
/** Characters that need no quoting in POSIX shells. Anything else (spaces,
 *  quotes, $, &, ;, parens, non-ASCII, …) gets the path single-quoted, with
 *  embedded single quotes escaped as '\'' (close, escaped quote, reopen). */
const SAFE = /^[A-Za-z0-9_\-./~+=:@%]+$/;

export function shellQuote(path: string): string {
  if (SAFE.test(path)) return path;
  return `'${path.replaceAll("'", "'\\''")}'`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/shellQuote.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shellQuote.ts src/lib/shellQuote.test.ts
git commit -m "feat(lib): shellQuote — POSIX-safe path quoting for PTY pastes"
```

---

### Task 2: `useListReorder` pointer-gesture hook

**Files:**
- Create: `src/hooks/useListReorder.ts`
- Test: `src/hooks/useListReorder.test.ts`

**Interfaces:**
- Produces (Task 3 consumes exactly this):

```typescript
interface ListReorder {
  /** Index being dragged, null when idle. Drives the drag styling. */
  dragIndex: number | null;
  /** Index currently hovered as the drop slot, null when idle/over source. */
  overIndex: number | null;
  /** Callback-ref factory: attach to each item's root element. */
  itemRef: (index: number) => (el: HTMLElement | null) => void;
  /** Arm a potential drag. Call from the item's onPointerDown. */
  handlePointerDown: (index: number, e: React.PointerEvent) => void;
  /** True exactly once after a completed drag — callers use it to swallow
   *  the click that the browser fires after pointerup. */
  consumeDragClick: () => boolean;
}
function useListReorder(onReorder: (from: number, to: number) => void): ListReorder;
```

**Design:** Follows `TerminalCanvas.startGesture` (`src/components/terminal/TerminalCanvas.tsx:104-144`): window-level `pointermove`/`pointerup` listeners registered on pointerdown, `document.body.style.userSelect = "none"` during the drag, no pointer capture. A 4px movement threshold separates click from drag. `overIndex` is computed by hit-testing the pointer's clientX against registered items' `getBoundingClientRect()` (horizontal lists only — the tab strip is the only consumer).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/hooks/useListReorder.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useListReorder } from "./useListReorder";

/** Give a detached element a fixed horizontal rect (jsdom rects are all 0). */
function makeItem(left: number, width: number): HTMLElement {
  const el = document.createElement("div");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: left, y: 0, left, top: 0, width, height: 32,
    right: left + width, bottom: 32,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

/** Register three 100px-wide items at x = 0, 100, 200. */
function setup(onReorder = vi.fn()) {
  const hook = renderHook(() => useListReorder(onReorder));
  const items = [makeItem(0, 100), makeItem(100, 100), makeItem(200, 100)];
  act(() => {
    items.forEach((el, i) => hook.result.current.itemRef(i)(el));
  });
  return { hook, items, onReorder };
}

function pointerDown(hook: ReturnType<typeof setup>["hook"], index: number, x: number) {
  act(() => {
    hook.result.current.handlePointerDown(index, {
      button: 0, clientX: x, clientY: 10,
    } as unknown as React.PointerEvent);
  });
}

function windowMove(x: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: 10 }));
  });
}

function windowUp() {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup", {}));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useListReorder", () => {
  it("does not start a drag below the movement threshold", () => {
    const { hook, onReorder } = setup();
    pointerDown(hook, 0, 50);
    windowMove(52); // 2px < 4px threshold
    expect(hook.result.current.dragIndex).toBeNull();
    windowUp();
    expect(onReorder).not.toHaveBeenCalled();
    expect(hook.result.current.consumeDragClick()).toBe(false);
  });

  it("tracks dragIndex and overIndex past the threshold and commits on release", () => {
    const { hook, onReorder } = setup();
    pointerDown(hook, 0, 50);
    windowMove(250); // into item 2's rect
    expect(hook.result.current.dragIndex).toBe(0);
    expect(hook.result.current.overIndex).toBe(2);
    windowUp();
    expect(onReorder).toHaveBeenCalledWith(0, 2);
    expect(hook.result.current.dragIndex).toBeNull();
    expect(hook.result.current.overIndex).toBeNull();
  });

  it("suppresses exactly one click after a completed drag", () => {
    const { hook } = setup();
    pointerDown(hook, 0, 50);
    windowMove(250);
    windowUp();
    expect(hook.result.current.consumeDragClick()).toBe(true);
    expect(hook.result.current.consumeDragClick()).toBe(false); // consumed
  });

  it("releasing over the source item does not reorder", () => {
    const { hook, onReorder } = setup();
    pointerDown(hook, 1, 150);
    windowMove(160); // past threshold, still inside item 1
    expect(hook.result.current.dragIndex).toBe(1);
    windowUp();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("ignores non-primary buttons", () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.handlePointerDown(0, {
        button: 2, clientX: 50, clientY: 10,
      } as unknown as React.PointerEvent);
    });
    windowMove(250);
    expect(hook.result.current.dragIndex).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useListReorder.test.ts`
Expected: FAIL — cannot resolve `./useListReorder`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/hooks/useListReorder.ts
import { useCallback, useRef, useState } from "react";
import type React from "react";

/** Movement (px) before a pointerdown becomes a drag instead of a click. */
const DRAG_THRESHOLD = 4;

export interface ListReorder {
  dragIndex: number | null;
  overIndex: number | null;
  itemRef: (index: number) => (el: HTMLElement | null) => void;
  handlePointerDown: (index: number, e: React.PointerEvent) => void;
  consumeDragClick: () => boolean;
}

/**
 * Pointer-event reorder gesture for a horizontal list (the workspace tab
 * strip). HTML5 drag-and-drop is not an option: with Tauri's native
 * drag-drop handler enabled, wry swallows DOM drag events on macOS.
 *
 * Mirrors TerminalCanvas.startGesture: window-level listeners for the life
 * of the gesture, text selection suppressed, a small threshold so plain
 * clicks (tab switch, rename double-click) never register as drags.
 */
export function useListReorder(
  onReorder: (from: number, to: number) => void
): ListReorder {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const itemsRef = useRef(new Map<number, HTMLElement>());
  // True between a completed drag's pointerup and the click it spawns;
  // consumeDragClick() reads-and-clears it.
  const dragClickRef = useRef(false);

  const itemRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el) itemsRef.current.set(index, el);
      else itemsRef.current.delete(index);
    },
    []
  );

  const indexAt = useCallback((clientX: number): number | null => {
    for (const [index, el] of itemsRef.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return index;
    }
    return null;
  }, []);

  const handlePointerDown = useCallback(
    (index: number, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      let dragging = false;

      const onMove = (ev: PointerEvent) => {
        if (!dragging) {
          if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
          dragging = true;
          setDragIndex(index);
          document.body.style.userSelect = "none";
        }
        const over = indexAt(ev.clientX);
        setOverIndex(over === index ? null : over);
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!dragging) return;
        document.body.style.userSelect = "";
        dragClickRef.current = true;
        const to = indexAt(ev.clientX);
        setDragIndex(null);
        setOverIndex(null);
        if (to !== null && to !== index) onReorder(index, to);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [indexAt, onReorder]
  );

  const consumeDragClick = useCallback(() => {
    const was = dragClickRef.current;
    dragClickRef.current = false;
    return was;
  }, []);

  return { dragIndex, overIndex, itemRef, handlePointerDown, consumeDragClick };
}
```

Note: `onUp` reads the release position from the `pointerup` event itself, not from `overIndex` state (state set in `onMove` isn't readable inside the same gesture's closures).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useListReorder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useListReorder.ts src/hooks/useListReorder.test.ts
git commit -m "feat(hooks): useListReorder — pointer-gesture list reorder"
```

---

### Task 3: Migrate TopBar tab reorder to `useListReorder`

**Files:**
- Modify: `src/components/layout/TopBar.tsx` (drag section: ~lines 50-80 state/handleDrop, ~lines 101-141 tab props)
- Modify: `src/components/layout/TopBar.test.tsx` ("TopBar reordering" describe block)

**Interfaces:**
- Consumes: `useListReorder(onReorder)` from Task 2, exactly as specified there.
- Produces: TopBar renders tabs with **no** `draggable`/`onDragStart`/`onDragOver`/`onDrop` attributes. Task 4 depends on this being true repo-wide.

- [ ] **Step 1: Rewrite the reordering tests to pointer events (failing first)**

Replace the entire `describe("TopBar reordering", …)` block in `TopBar.test.tsx` with:

```typescript
describe("TopBar reordering", () => {
  const threeWorkspaces = [
    { id: "w1", name: "One" },
    { id: "w2", name: "Two" },
    { id: "w3", name: "Three" },
  ];

  /** Tabs get fixed horizontal rects (jsdom rects are all 0): each tab is
   *  100px wide at x = 0, 100, 200. */
  function mockTabRects() {
    for (const [name, left] of [["One", 0], ["Two", 100], ["Three", 200]] as const) {
      const tab = screen.getByText(name).closest("[data-tab]")!;
      vi.spyOn(tab, "getBoundingClientRect").mockReturnValue({
        x: left, y: 0, left, top: 0, width: 100, height: 32,
        right: left + 100, bottom: 32,
        toJSON: () => ({}),
      } as DOMRect);
    }
  }

  function dragTab(fromX: number, toX: number, target: Element) {
    fireEvent.pointerDown(target, { button: 0, clientX: fromX, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: toX, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: toX, clientY: 10 });
  }

  it("reorders workspaces when a tab is dragged onto another", () => {
    const props = renderTopBar({ workspaces: threeWorkspaces, counts: {} });
    mockTabRects();
    dragTab(50, 250, screen.getByText("One"));
    expect(props.onReorder).toHaveBeenCalledWith(["w2", "w3", "w1"]);
  });

  it("a sub-threshold press is a click (switch), not a drag", () => {
    const props = renderTopBar({ workspaces: threeWorkspaces, counts: {} });
    mockTabRects();
    dragTab(50, 52, screen.getByText("Two")); // 2px < threshold
    fireEvent.click(screen.getByText("Two"));
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(props.onSwitch).toHaveBeenCalledWith("w2");
  });

  it("the click after a completed drag does not switch workspaces", () => {
    const props = renderTopBar({ workspaces: threeWorkspaces, counts: {} });
    mockTabRects();
    dragTab(50, 250, screen.getByText("One"));
    // Browsers fire a click on the source element after pointerup.
    fireEvent.click(screen.getByText("One"));
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it("a tab being renamed does not start a drag", () => {
    const props = renderTopBar({ workspaces: threeWorkspaces, counts: {} });
    mockTabRects();
    fireEvent.doubleClick(screen.getByText("Two"));
    const input = screen.getByDisplayValue("Two");
    // Selecting text inside the rename input sweeps the pointer sideways —
    // that must not reorder anything.
    dragTab(150, 250, input);
    expect(props.onReorder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/components/layout/TopBar.test.tsx`
Expected: the 4 rewritten tests FAIL (no `data-tab` attribute, HTML5 handlers still present); the other describes still PASS.

- [ ] **Step 3: Migrate TopBar.tsx**

In `TopBar.tsx`:

1. Add import: `import { useListReorder } from "../../hooks/useListReorder";`
2. Delete the `dragIndex`/`overIndex` state and `handleDrop` (lines ~51-54 and ~70-79) and replace with:

```typescript
const reorder = useListReorder((from, to) => {
  const next = workspaces.map((w) => w.id);
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  onReorder(next);
});
```

3. On the tab root `<div>` (the one keyed `ws.id`): remove `draggable`, `onDragStart`, `onDragEnd`, `onDragOver`, `onDrop` entirely, and add:

```tsx
data-tab
ref={reorder.itemRef(index)}
onPointerDown={(e) => {
  // A tab being renamed hosts a text input — selecting its text must not
  // start a tab drag.
  if (editingId !== ws.id) reorder.handlePointerDown(index, e);
}}
onClick={() => {
  if (reorder.consumeDragClick()) return; // tail end of a drag, not a click
  onSwitch(ws.id);
}}
```

(The existing `onClick={() => onSwitch(ws.id)}` is replaced by the guarded version above.)

4. Update the styling conditions to the hook's state — the existing classes stay identical, only the sources change:

```tsx
${reorder.dragIndex === index ? "opacity-40" : ""} ${
  reorder.overIndex === index && reorder.dragIndex !== index
    ? "ring-1 ring-accent-cyan/60 bg-accent-cyan/5 scale-105"
    : ""
}
```

5. Update the tab `title` to `"Double-click to rename — drag to reorder"` (unchanged copy, just confirm it stays).
6. Remove the now-unused comment about Firefox `setData`.

- [ ] **Step 4: Run the full TopBar suite**

Run: `npx vitest run src/components/layout/TopBar.test.tsx`
Expected: PASS (all describes).

- [ ] **Step 5: Verify no HTML5 dnd remains in src/**

Run: `grep -rn "draggable\|onDragStart\|onDragOver\|onDrop\|dataTransfer" src --include="*.tsx" --include="*.ts" | grep -v test | grep -v "// "`
Expected: no matches in component code (comment-only mentions in TerminalCanvas/TerminalGrid/useCanvasLayout are fine).

- [ ] **Step 6: Typecheck + full suite + commit**

```bash
npx tsc --noEmit && npm test
git add src/components/layout/TopBar.tsx src/components/layout/TopBar.test.tsx
git commit -m "refactor(topbar): tab reorder via pointer gestures, not HTML5 dnd"
```

---

### Task 4: Re-enable Tauri's native drag-drop

**Files:**
- Modify: `src-tauri/tauri.conf.json` (remove `"dragDropEnabled": false` from the main window entry)
- Modify: `src-tauri/src/commands/window.rs` (remove `.disable_drag_drop_handler()` + its comment in `open_window`)

**Interfaces:**
- Produces: `tauri://drag-drop` events now reach the webview; Task 5's `onDragDropEvent` subscription receives real file paths. OS drops no longer navigate the webview (wry consumes them).

- [ ] **Step 1: Flip the config**

In `src-tauri/tauri.conf.json`, delete the line `"dragDropEnabled": false` (the Tauri default is `true`).

In `src-tauri/src/commands/window.rs`, in `open_window`, delete:

```rust
        // Tauri's native drag-drop handler swallows DOM dragover/drop on macOS
        // (wry overrides NSDraggingDestination without forwarding to WKWebView),
        // which kills HTML5 drag-and-drop — the sidebar and workspace-bar
        // reordering need it. Nothing accepts OS file drops, so disable it.
        // Keep in sync with dragDropEnabled=false in tauri.conf.json.
        .disable_drag_drop_handler()
```

(No replacement comment needed — default behavior needs no explanation; the reorder UIs no longer use HTML5 dnd as of Task 3.)

- [ ] **Step 2: Verify Rust still builds and tests pass**

Run: `cd src-tauri && cargo test --quiet`
Expected: all tests pass, no warnings about unused imports (none of the removed code used imports exclusively).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/commands/window.rs
git commit -m "fix(dnd): re-enable Tauri drag-drop — OS file drops no longer navigate the webview"
```

---

### Task 5: `useFileDrop` hook

**Files:**
- Create: `src/hooks/useFileDrop.ts`
- Test: `src/hooks/useFileDrop.test.ts`

**Interfaces:**
- Consumes: `getCurrentWebview().onDragDropEvent` (`@tauri-apps/api/webview`); DOM `document.elementFromPoint`.
- Produces (Task 6 consumes exactly this):

```typescript
/** Subscribe this window to OS file drags. Returns the pane id currently
 *  hovered by a drag (for highlight), or null. Fires onDropPaths(paneId,
 *  paths) when files are dropped on a terminal pane. */
function useFileDrop(onDropPaths: (paneId: string, paths: string[]) => void): string | null;
```

Panes are located by `document.elementFromPoint(x/devicePixelRatio, y/devicePixelRatio)` + `.closest('[data-pane-kind="terminal"]')`, reading `dataset.paneId` — Task 6 adds those attributes to the pane wrapper.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/hooks/useFileDrop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Capture the handler that useFileDrop registers so tests can drive events.
let dragHandler: ((event: { payload: unknown }) => void) | undefined;
const unlisten = vi.fn();
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async (h: (event: { payload: unknown }) => void) => {
      dragHandler = h;
      return unlisten;
    }),
  }),
}));

import { useFileDrop } from "./useFileDrop";

/** A fake terminal pane in the DOM for elementFromPoint to find. */
function addPane(id: string): HTMLElement {
  const pane = document.createElement("div");
  pane.dataset.paneId = id;
  pane.dataset.paneKind = "terminal";
  const inner = document.createElement("span"); // drops land on descendants
  pane.appendChild(inner);
  document.body.appendChild(pane);
  return inner;
}

function fire(payload: unknown) {
  act(() => {
    dragHandler!({ payload });
  });
}

beforeEach(() => {
  dragHandler = undefined;
  unlisten.mockClear();
  document.body.innerHTML = "";
  Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFileDrop", () => {
  it("highlights the terminal pane under the drag, in logical coordinates", async () => {
    const inner = addPane("t1");
    // Position is physical (2x); the hook must query at physical/2.
    const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(inner);
    const hook = renderHook(() => useFileDrop(vi.fn()));
    await act(async () => {}); // flush the async subscription
    fire({ type: "over", position: { x: 400, y: 200 } });
    expect(spy).toHaveBeenCalledWith(200, 100);
    expect(hook.result.current).toBe("t1");
  });

  it("clears the highlight when the drag leaves the window", async () => {
    const inner = addPane("t1");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(inner);
    const hook = renderHook(() => useFileDrop(vi.fn()));
    await act(async () => {});
    fire({ type: "over", position: { x: 400, y: 200 } });
    fire({ type: "leave" });
    expect(hook.result.current).toBeNull();
  });

  it("delivers dropped paths to the pane under the cursor and clears the highlight", async () => {
    const inner = addPane("t1");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(inner);
    const onDropPaths = vi.fn();
    const hook = renderHook(() => useFileDrop(onDropPaths));
    await act(async () => {});
    fire({
      type: "drop",
      position: { x: 400, y: 200 },
      paths: ["/tmp/a.txt", "/tmp/b file.md"],
    });
    expect(onDropPaths).toHaveBeenCalledWith("t1", ["/tmp/a.txt", "/tmp/b file.md"]);
    expect(hook.result.current).toBeNull();
  });

  it("a drop over nothing (or a non-terminal pane) is a silent no-op", async () => {
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    const onDropPaths = vi.fn();
    renderHook(() => useFileDrop(onDropPaths));
    await act(async () => {});
    fire({ type: "drop", position: { x: 10, y: 10 }, paths: ["/tmp/a.txt"] });
    expect(onDropPaths).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", async () => {
    const hook = renderHook(() => useFileDrop(vi.fn()));
    await act(async () => {});
    hook.unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useFileDrop.test.ts`
Expected: FAIL — cannot resolve `./useFileDrop`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/hooks/useFileDrop.ts
import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** The terminal pane under a physical-pixel position, or null. Drag-drop
 *  events report physical coordinates; elementFromPoint wants CSS pixels. */
function paneAt(position: { x: number; y: number }): string | null {
  const scale = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / scale, position.y / scale);
  const pane = el?.closest<HTMLElement>('[data-pane-kind="terminal"]');
  return pane?.dataset.paneId ?? null;
}

/**
 * Per-window subscription to Tauri's native drag-drop events (the only
 * source of real file paths — WKWebView's HTML5 File objects have none).
 * Returns the pane id a drag is currently hovering, for highlight.
 */
export function useFileDrop(
  onDropPaths: (paneId: string, paths: string[]) => void
): string | null {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Ref so the subscription (created once) always calls the latest callback.
  const onDropRef = useRef(onDropPaths);
  onDropRef.current = onDropPaths;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload as
          | { type: "enter" | "drop"; position: { x: number; y: number }; paths: string[] }
          | { type: "over"; position: { x: number; y: number } }
          | { type: "leave" };
        if (p.type === "leave") {
          setDropTargetId(null);
          return;
        }
        const paneId = paneAt(p.position);
        if (p.type === "drop") {
          setDropTargetId(null);
          if (paneId && p.paths.length > 0) onDropRef.current(paneId, p.paths);
        } else {
          setDropTargetId(paneId);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(console.error);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return dropTargetId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useFileDrop.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileDrop.ts src/hooks/useFileDrop.test.ts
git commit -m "feat(hooks): useFileDrop — native drag-drop to terminal-pane targeting"
```

---

### Task 6: Wire file drops through App → TerminalGrid → TerminalCanvas

**Files:**
- Modify: `src/App.tsx` (mount the hook, implement the drop action, pass `dropTargetId` down)
- Modify: `src/components/terminal/TerminalGrid.tsx` (accept + forward `dropTargetId`)
- Modify: `src/components/terminal/TerminalCanvas.tsx` (pane wrapper: data attributes + highlight ring)

**Interfaces:**
- Consumes: `useFileDrop` (Task 5), `shellQuote` (Task 1), `ptyWrite(id, data)` from `src/lib/ipc.ts:33`.
- Produces: pane wrappers carry `data-pane-id={pane.id}` and `data-pane-kind={pane.kind}`; the hovered terminal pane shows the cyan ring; dropping writes `paths.map(shellQuote).join(" ") + " "` to that pane's PTY and focuses it.

- [ ] **Step 1: App.tsx — mount and act**

Add imports:

```typescript
import { useFileDrop } from "./hooks/useFileDrop";
import { shellQuote } from "./lib/shellQuote";
import { ptyWrite } from "./lib/ipc";
```

(`ptyWrite` joins the existing `./lib/ipc` import list.)

Inside `App()`, after the `useConfirm`/`useSounds` block:

```typescript
// OS file drops: paste the dropped path(s) into the terminal pane under
// the cursor and focus it. Drops elsewhere are no-ops by design.
const handleDropPaths = useCallback(
  (paneId: string, paths: string[]) => {
    ptyWrite(paneId, paths.map(shellQuote).join(" ") + " ").catch((e) =>
      console.error("Failed to paste dropped paths:", e)
    );
    setActiveId(paneId);
  },
  [setActiveId]
);
const dropTargetId = useFileDrop(handleDropPaths);
```

Pass it to every `<TerminalGrid …>` (the per-workspace map): `dropTargetId={dropTargetId}`.

- [ ] **Step 2: TerminalGrid.tsx — forward the prop**

Add to `TerminalGridProps`: `dropTargetId: string | null;` and forward `dropTargetId={dropTargetId}` to `<TerminalCanvas …>`.

- [ ] **Step 3: TerminalCanvas.tsx — data attributes + ring**

Add to `TerminalCanvasProps`: `dropTargetId: string | null;` (destructure it in the component).

On the pane wrapper `<div key={pane.id} …>` (`TerminalCanvas.tsx:163-175`), add the data attributes and highlight:

```tsx
<div
  key={pane.id}
  data-pane-id={pane.id}
  data-pane-kind={pane.kind}
  className={`absolute rounded-lg overflow-hidden terminal-window ${
    isActive ? "is-active" : ""
  } ${pane.id === dropTargetId ? "ring-1 ring-accent-cyan/60" : ""}`}
  …
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean typecheck, all tests pass (TerminalGrid/Canvas have no unit tests of their own; the hook and helpers carry the logic coverage — the visual wiring is covered by the Task 7 smoke test).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/terminal/TerminalGrid.tsx src/components/terminal/TerminalCanvas.tsx
git commit -m "feat(dnd): file drops paste shell-quoted paths into the hovered terminal"
```

---

### Task 7: Full verification + build

**Files:** none (verification only)

- [ ] **Step 1: Full local gate**

```bash
npx tsc --noEmit && npm test && (cd src-tauri && cargo test --quiet)
```

Expected: everything green.

- [ ] **Step 2: Build the bundle (do NOT launch it — the user runs the app live)**

```bash
npm run tauri build
```

Expected: `Finished 1 bundle at: …/target/release/bundle/macos/Claude Cockpit.app`.

- [ ] **Step 3: Hand the user this smoke checklist** (they restart into the new build)

1. Drag a file from Finder over a terminal pane → pane shows a cyan ring while hovered.
2. Drop it → the shell-quoted path appears in that terminal's input line with a trailing space; the pane is focused. Webview must NOT navigate.
3. Drop a file on empty canvas / the sidebar / the top bar → nothing happens (and no navigation).
4. Multi-select two files (one with a space in its name), drop on a pane → both paths pasted, second one quoted.
5. Drag a workspace tab → reorder still works, drop styling (ring + scale) intact; a plain click still switches; double-click still renames.
6. Repeat (1)-(2) on the 2× built-in display AND on a 1× external — the ring must track the cursor on both (physical→logical division).

- [ ] **Step 4: Commit any checklist-driven fixes, then mark this plan done in place**

Per repo convention: one line, date + outcome + commit SHA, no code snippets.

---

## Self-Review (completed at plan-writing time)

- **Spec coverage:** config flip → Task 4; pointer migration (amended: tabs only) → Tasks 2-3; file drops paste into PTY → Tasks 5-6; shellQuote → Task 1; testing section → embedded per task + Task 7 smoke checklist. Viewer panes for empty-canvas drops: explicitly out of scope per spec.
- **Ordering constraint honored:** HTML5 dnd is removed (Task 3) *before* the native handler is enabled (Task 4), so tab reorder never has a dead window.
- **Type consistency:** `useListReorder` signature in Task 3 matches Task 2; `useFileDrop`/`dropTargetId`/`data-pane-*` names in Task 6 match Task 5; `shellQuote` usage matches Task 1.
