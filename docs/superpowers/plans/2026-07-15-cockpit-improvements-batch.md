# Cockpit Improvements Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 9 approved cockpit improvements: per-kind pane tooltips, visible move-to-workspace menu, bottom-anchored terminal refits, compact pomodoro, session starring, canvas-filling first pane, level-up celebration + character card, and model·effort·tokens in the terminal header.

**Architecture:** React 19 + Tailwind 4 frontend talking to a Tauri v2 Rust backend over `invoke`. All state patterns follow existing precedent: JSON stores in `~/.claude-cockpit/`, transcript tail-scanning in `session/jsonl.rs`, hooks in `src/hooks/`, pure logic in `src/lib/` with vitest coverage.

**Tech Stack:** TypeScript, React 19, Tailwind CSS v4, vitest + @testing-library/react (jsdom), Rust (Tauri v2, serde), xterm.js 6.

**Spec:** `docs/superpowers/specs/2026-07-15-cockpit-improvements-batch-design.md` (approved).

## Global Constraints

- **NEVER rebuild, relaunch, or close the running app.** Kenneth uses cockpit live. Forbidden: `cargo tauri build`, `cargo tauri dev`, `npm run build`, `npm run dev`, killing/launching the Claude Cockpit app. Allowed: `npx tsc --noEmit`, `npm test`, `cargo test` (in `src-tauri/`), `cargo check`.
- **No new runtime dependencies** (npm or crate). Portals, ResizeObserver, CSS container queries, CSS animations only.
- **Branch:** all work on `feature/cockpit-improvements-batch` off `main`, in this checkout (no worktree needed — the running app is a compiled bundle and never reads source).
- **TDD:** every task writes its failing test first. Frontend: `npm test`. Rust: `cd src-tauri && cargo test`.
- Frontend/Rust field-name contract: Rust structs here serialize with their literal snake/single-word field names (no `rename_all`) — `tokens`, `model`, `effort`, `starred` cross the IPC boundary as-is.
- Task order matters only where noted: Task 5 → 6, Task 7 → 8, Task 9 → 10, Task 11 → 12 → 13.

---

### Task 1: Per-kind pane count labels (spec item 1)

**Files:**
- Create: `src/lib/paneCounts.ts`
- Create: `src/lib/paneCounts.test.ts`
- Modify: `src/components/terminal/TerminalGrid.tsx:100-113` (replace inline `countLabel`)
- Modify: `src/components/layout/WorkspaceBar.tsx` (badge tooltip)
- Modify: `src/App.tsx:204-210` (`workspacePaneCounts`)

**Interfaces:**
- Produces: `paneCountLabel(panes: Pick<Pane, "kind">[]): string` — "2 terminals · 1 note", "Empty" for none.
- Produces: `WorkspaceBar` prop `paneCounts: Record<string, { count: number; label: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/paneCounts.test.ts
import { describe, it, expect } from "vitest";
import { paneCountLabel } from "./paneCounts";

describe("paneCountLabel", () => {
  it("returns Empty for no panes", () => {
    expect(paneCountLabel([])).toBe("Empty");
  });

  it("labels a single pane by its kind", () => {
    expect(paneCountLabel([{ kind: "note" }])).toBe("1 note");
    expect(paneCountLabel([{ kind: "pomodoro" }])).toBe("1 timer");
    expect(paneCountLabel([{ kind: "mdviewer" }])).toBe("1 plan");
    expect(paneCountLabel([{ kind: "terminal" }])).toBe("1 terminal");
  });

  it("pluralizes and joins mixed kinds in stable order", () => {
    expect(
      paneCountLabel([
        { kind: "note" },
        { kind: "terminal" },
        { kind: "terminal" },
        { kind: "pomodoro" },
      ])
    ).toBe("2 terminals · 1 note · 1 timer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- paneCounts`
Expected: FAIL — cannot resolve `./paneCounts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/paneCounts.ts
import type { Pane } from "../types/pane";

// Display nouns per pane kind, in the order they appear in labels.
const KIND_NOUNS: [Pane["kind"], string][] = [
  ["terminal", "terminal"],
  ["note", "note"],
  ["mdviewer", "plan"],
  ["pomodoro", "timer"],
];

/**
 * Human label for a set of panes, broken down by kind:
 * "2 terminals · 1 note · 1 timer". Kinds with zero panes are omitted;
 * no panes at all yields "Empty".
 */
export function paneCountLabel(panes: Pick<Pane, "kind">[]): string {
  const parts = KIND_NOUNS.map(([kind, noun]) => {
    const count = panes.filter((p) => p.kind === kind).length;
    if (count === 0) return "";
    return `${count} ${noun}${count !== 1 ? "s" : ""}`;
  }).filter(Boolean);
  return parts.join(" · ") || "Empty";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- paneCounts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use the helper in TerminalGrid**

In `src/components/terminal/TerminalGrid.tsx`, add the import and replace the whole `termCount`/`noteCount`/`viewerCount`/`timerCount`/`countLabel` block (lines 100–113) with one line:

```tsx
import { paneCountLabel } from "../../lib/paneCounts";
// ...
const countLabel = paneCountLabel(panes);
```

The `<span className="text-xs text-foreground-muted">{countLabel}</span>` usage is unchanged.

- [ ] **Step 6: Thread the label into the WorkspaceBar badge**

In `src/App.tsx`, replace the `workspacePaneCounts` memo (lines 204–210) with:

```tsx
import { paneCountLabel } from "./lib/paneCounts";
// ...
const workspacePaneCounts = useMemo(() => {
  const result: Record<string, { count: number; label: string }> = {};
  for (const ws of workspaces) {
    const wsPanes = panes.filter((p) => p.workspaceId === ws.id);
    if (wsPanes.length > 0) {
      result[ws.id] = { count: wsPanes.length, label: paneCountLabel(wsPanes) };
    }
  }
  return result;
}, [panes, workspaces]);
```

In `src/components/layout/WorkspaceBar.tsx`, change the prop type and the badge:

```tsx
interface WorkspaceBarProps {
  // ...unchanged...
  paneCounts: Record<string, { count: number; label: string }>;
  // ...unchanged...
}
```

Replace the pane badge block (lines 89–97) with:

```tsx
{paneCounts[ws.id] && (
  <span
    className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-foreground-muted"
    title={paneCounts[ws.id].label}
  >
    <StickyNote size={9} />
    {paneCounts[ws.id].count}
  </span>
)}
```

- [ ] **Step 7: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/paneCounts.ts src/lib/paneCounts.test.ts src/components/terminal/TerminalGrid.tsx src/components/layout/WorkspaceBar.tsx src/App.tsx
git commit -m "fix(workspaces): per-kind pane counts in workspace tab tooltip"
```

---

### Task 2: Bottom-anchored terminal refits (spec item 3)

**Files:**
- Create: `src/lib/xtermScroll.ts`
- Create: `src/lib/xtermScroll.test.ts`
- Modify: `src/hooks/useTerminal.ts` (delete local `scrollSafeFit` at lines 22–41; import the new one; update both call sites)

**Interfaces:**
- Produces: `scrollSafeFit(term: ScrollableTerm, fitAddon: Fitter, container: HTMLElement): void` where `ScrollableTerm = { buffer: { active: { viewportY: number; baseY: number } }; scrollToBottom(): void }` and `Fitter = { fit(): void }` (xterm's `Terminal` and `FitAddon` satisfy these structurally).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/xtermScroll.test.ts
import { describe, it, expect, vi } from "vitest";
import { scrollSafeFit, type ScrollableTerm, type Fitter } from "./xtermScroll";

function makeTerm(viewportY: number, baseY: number): ScrollableTerm {
  return {
    buffer: { active: { viewportY, baseY } },
    scrollToBottom: vi.fn(),
  };
}

function makeContainer(withViewport = true): HTMLElement {
  const container = document.createElement("div");
  if (withViewport) {
    const viewport = document.createElement("div");
    viewport.className = "xterm-viewport";
    viewport.scrollTop = 120;
    container.appendChild(viewport);
  }
  return container;
}

describe("scrollSafeFit", () => {
  it("snaps to the bottom after fitting when the viewport was at the bottom", () => {
    const term = makeTerm(50, 50); // viewportY === baseY → at bottom
    const fit: Fitter = { fit: vi.fn() };
    scrollSafeFit(term, fit, makeContainer());
    expect(fit.fit).toHaveBeenCalledOnce();
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
  });

  it("preserves the absolute scroll position when scrolled up into history", () => {
    const term = makeTerm(10, 50); // scrolled up
    const fit: Fitter = { fit: vi.fn() };
    const container = makeContainer();
    const viewport = container.querySelector(".xterm-viewport") as HTMLElement;
    scrollSafeFit(term, fit, container);
    expect(term.scrollToBottom).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(120);
    expect(viewport.style.overflowY).toBe("");
  });

  it("still fits (and follows the bottom) when the viewport element is missing", () => {
    const term = makeTerm(50, 50);
    const fit: Fitter = { fit: vi.fn() };
    scrollSafeFit(term, fit, makeContainer(false));
    expect(fit.fit).toHaveBeenCalledOnce();
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- xtermScroll`
Expected: FAIL — cannot resolve `./xtermScroll`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/xtermScroll.ts

/** The slice of xterm's Terminal that scroll-safe fitting needs. */
export interface ScrollableTerm {
  buffer: { active: { viewportY: number; baseY: number } };
  scrollToBottom(): void;
}

/** The slice of FitAddon that scroll-safe fitting needs. */
export interface Fitter {
  fit(): void;
}

/**
 * Calls fitAddon.fit() without losing the user's place in the terminal.
 *
 * When the viewport is at the live bottom (viewportY has caught up to baseY),
 * the user is following output, so the refit must land back at the *new*
 * bottom — restoring the old absolute scrollTop here is what used to leave
 * the newest lines (e.g. a question Claude just painted) hidden after a
 * pane/window resize. When the user has scrolled up into history, the
 * absolute position is preserved instead.
 */
export function scrollSafeFit(
  term: ScrollableTerm,
  fitAddon: Fitter,
  container: HTMLElement
): void {
  const { viewportY, baseY } = term.buffer.active;
  const atBottom = viewportY >= baseY;

  const viewport = container.querySelector(
    ".xterm-viewport"
  ) as HTMLElement | null;
  if (!viewport) {
    fitAddon.fit();
    if (atBottom) term.scrollToBottom();
    return;
  }

  const scrollTop = viewport.scrollTop;
  // Lock scroll during fit so the browser can't adjust scrollTop mid-resize.
  viewport.style.overflowY = "hidden";
  fitAddon.fit();
  if (atBottom) {
    term.scrollToBottom();
  } else {
    viewport.scrollTop = scrollTop;
  }
  viewport.style.overflowY = "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- xtermScroll`
Expected: PASS (3 tests).

- [ ] **Step 5: Switch useTerminal to the shared helper**

In `src/hooks/useTerminal.ts`:
1. Delete the local `scrollSafeFit` function (lines 22–41, including its doc comment).
2. Add `import { scrollSafeFit } from "../lib/xtermScroll";`.
3. Update both call sites to pass the terminal:
   - in `applyFit` (inside `mount`): `scrollSafeFit(term, fitAddon, container);`
   - in the font-size effect: `scrollSafeFit(term, fitAddon, container);`

- [ ] **Step 6: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/xtermScroll.ts src/lib/xtermScroll.test.ts src/hooks/useTerminal.ts
git commit -m "fix(terminal): keep viewport bottom-anchored across refits"
```

---

### Task 3: First pane in an empty workspace fills the canvas (spec item 6)

**Files:**
- Modify: `src/hooks/useCanvasLayout.ts`
- Modify: `src/hooks/useCanvasLayout.test.ts` (add cases)
- Modify: `src/components/terminal/TerminalGrid.tsx:49` (pass surface size getter)

**Interfaces:**
- Produces: `useCanvasLayout(ids: string[], getSurfaceSize?: () => { w: number; h: number } | null)` — same return shape as today. When pane membership goes 0 → 1 and the surface reports a positive size, the single pane is seeded with `tileRects([id], 1, w, h)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/hooks/useCanvasLayout.test.ts` (match the file's existing `renderHook` style — read it first and reuse its imports/helpers):

```ts
describe("first-pane fill seeding", () => {
  it("seeds the first pane of an empty canvas to fill the surface", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) =>
        useCanvasLayout(ids, () => ({ w: 1000, h: 600 })),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a"] });
    // tileRects([a], 1, 1000, 600): full surface minus margins.
    expect(result.current.layout["a"]).toEqual(
      tileRects(["a"], 1, 1000, 600)["a"]
    );
  });

  it("seeds later panes with the staggered default, not the fill", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) =>
        useCanvasLayout(ids, () => ({ w: 1000, h: 600 })),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a"] });
    rerender({ ids: ["a", "b"] });
    const b = result.current.layout["b"];
    expect(b.w).toBe(520); // DEFAULT_W stagger, not a fill
    expect(b.h).toBe(340);
  });

  it("falls back to the staggered seed when the surface size is unknown", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, () => null),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a"] });
    expect(result.current.layout["a"].w).toBe(520);
  });

  it("does not fill when several panes appear at once (session restore)", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) =>
        useCanvasLayout(ids, () => ({ w: 1000, h: 600 })),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a", "b"] });
    expect(result.current.layout["a"].w).toBe(520);
    expect(result.current.layout["b"].w).toBe(520);
  });
});
```

Import `tileRects` in the test file if not already imported.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- useCanvasLayout`
Expected: the four new tests FAIL (hook doesn't accept the second argument / fill behavior missing); existing tests still pass.

- [ ] **Step 3: Implement seeding**

In `src/hooks/useCanvasLayout.ts`, update the hook (keep `seedRect`, `tileRects` etc. unchanged):

```ts
export function useCanvasLayout(
  ids: string[],
  getSurfaceSize?: () => { w: number; h: number } | null
) {
  const [layout, setLayout] = useState<Record<string, Rect>>({});

  // Read through a ref so the seeding effect depends only on `ids` — the
  // getter is a fresh closure every render.
  const getSurfaceSizeRef = useRef(getSurfaceSize);
  getSurfaceSizeRef.current = getSurfaceSize;

  useEffect(() => {
    setLayout((prev) => {
      const next: Record<string, Rect> = {};
      let seedCount = Object.keys(prev).length;
      // A single pane arriving on an empty canvas fills the visible surface —
      // same geometry as the "1" arrange preset — instead of the small
      // staggered seed. Multiple panes arriving at once (session restore) and
      // every later pane keep the staggered seeding.
      const fillFirst = seedCount === 0 && ids.length === 1;
      for (const id of ids) {
        if (prev[id]) {
          next[id] = prev[id];
          continue;
        }
        if (fillFirst) {
          const size = getSurfaceSizeRef.current?.() ?? null;
          if (size && size.w > 0 && size.h > 0) {
            next[id] = tileRects([id], 1, size.w, size.h)[id];
            continue;
          }
        }
        next[id] = seedRect(seedCount++);
      }
      const sameKeys =
        Object.keys(next).length === Object.keys(prev).length &&
        ids.every((id) => prev[id]);
      return sameKeys ? prev : next;
    });
  }, [ids]);
  // ...setRect / setAll unchanged...
}
```

Add `useRef` to the react import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- useCanvasLayout`
Expected: PASS, including pre-existing tests.

- [ ] **Step 5: Pass the surface getter from TerminalGrid**

In `src/components/terminal/TerminalGrid.tsx:49`:

```tsx
const { layout, setRect, setAll } = useCanvasLayout(ids, () => {
  const s = surfaceRef.current;
  return s ? { w: s.clientWidth, h: s.clientHeight } : null;
});
```

Note: `surfaceRef` is declared right below the hook call today — move `const surfaceRef = useRef<HTMLDivElement>(null);` above the `useCanvasLayout` call.

- [ ] **Step 6: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useCanvasLayout.ts src/hooks/useCanvasLayout.test.ts src/components/terminal/TerminalGrid.tsx
git commit -m "feat(canvas): first pane in an empty workspace fills the surface"
```

---

### Task 4: Portal the move-to-workspace popover (spec item 2)

**Files:**
- Modify: `src/components/terminal/MoveToWorkspaceMenu.tsx` (full rewrite below)
- Create: `src/components/terminal/MoveToWorkspaceMenu.test.tsx`

**Interfaces:**
- Consumes/Produces: component props are UNCHANGED (`currentWorkspaceId`, `workspaces`, `onMove`, `open`, `onOpenChange`) — `TerminalCell` and `PaneHeader` need no changes.

**Why:** the popover currently renders inside the pane header, a `backdrop-blur` stacking context with `z-index: auto`; xterm's positioned opaque layers paint after it in tree order and completely cover it. A portal to `document.body` with fixed positioning escapes both the stacking context and the pane's `overflow-hidden`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/terminal/MoveToWorkspaceMenu.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";
import type { Workspace } from "../../types/terminal";

const workspaces: Workspace[] = [
  { id: "ws1", name: "Workspace 1" },
  { id: "ws2", name: "Workspace 2" },
];

function renderMenu(open = true, onMove = vi.fn(), onOpenChange = vi.fn()) {
  const utils = render(
    <div data-testid="pane-header">
      <MoveToWorkspaceMenu
        currentWorkspaceId="ws1"
        workspaces={workspaces}
        onMove={onMove}
        open={open}
        onOpenChange={onOpenChange}
      />
    </div>
  );
  return { ...utils, onMove, onOpenChange };
}

describe("MoveToWorkspaceMenu", () => {
  it("renders the open popover as a direct child of document.body (portal)", () => {
    renderMenu();
    const item = screen.getByText("Workspace 2");
    // Walk up: the popover's root must be parented by body, not the header.
    let node: HTMLElement | null = item;
    while (node && node.parentElement !== document.body) {
      node = node.parentElement;
    }
    expect(node).not.toBeNull();
    expect(node!.parentElement).toBe(document.body);
  });

  it("moves to the clicked workspace and closes", () => {
    const { onMove, onOpenChange } = renderMenu();
    fireEvent.click(screen.getByText("Workspace 2"));
    expect(onMove).toHaveBeenCalledWith("ws2");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on an outside mousedown", () => {
    const { onOpenChange } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing when there is nowhere to move to", () => {
    const { container } = render(
      <MoveToWorkspaceMenu
        currentWorkspaceId="ws1"
        workspaces={[workspaces[0]]}
        onMove={vi.fn()}
        open={false}
        onOpenChange={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MoveToWorkspaceMenu`
Expected: the portal test FAILS (popover is inside the header today); the others pass — that's fine, the portal test is the driver.

- [ ] **Step 3: Rewrite the component**

Replace the body of `src/components/terminal/MoveToWorkspaceMenu.tsx` with:

```tsx
import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderInput } from "lucide-react";
import type { Workspace } from "../../types/terminal";

interface MoveToWorkspaceMenuProps {
  currentWorkspaceId: string;
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
  /** Controlled open state so a header right-click can open the same popover. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A small header control: a "move" button that toggles a popover listing every
 * workspace except the current one. Clicking a workspace moves the pane there.
 * Renders nothing when there is nowhere else to move to.
 *
 * The popover is portaled to document.body with fixed positioning. Inside the
 * pane it would be unusable: the header's backdrop-filter creates a
 * zero-z-index stacking context that xterm's positioned opaque layers paint
 * over, and the pane's overflow-hidden would clip it in short panes.
 */
export function MoveToWorkspaceMenu({
  currentWorkspaceId,
  workspaces,
  onMove,
  open,
  onOpenChange,
}: MoveToWorkspaceMenuProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const targets = workspaces.filter((w) => w.id !== currentWorkspaceId);

  // Anchor the fixed-position popover to the trigger button when opening.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [open]);

  // A fixed-position menu must not drift from its anchor: close on any
  // scroll/resize as well as outside clicks and Escape.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) {
        return;
      }
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const close = () => onOpenChange(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open, onOpenChange]);

  if (targets.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        title="Move to workspace"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
      >
        <FolderInput size={11} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[10rem] rounded-md border border-card-border bg-background-secondary/95 backdrop-blur-xl shadow-lg py-1"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-foreground-muted/60">
              Move to
            </div>
            {targets.map((w) => (
              <button
                key={w.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(w.id);
                  onOpenChange(false);
                }}
                className="w-full text-left px-2 py-1 text-xs text-foreground hover:bg-white/10 truncate"
              >
                {w.name}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- MoveToWorkspaceMenu`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean. `TerminalCell.tsx` and `PaneHeader.tsx` compile unchanged (same props).

- [ ] **Step 6: Commit**

```bash
git add src/components/terminal/MoveToWorkspaceMenu.tsx src/components/terminal/MoveToWorkspaceMenu.test.tsx
git commit -m "fix(panes): portal move-to-workspace popover so xterm can't paint over it"
```

---

### Task 5: `useElementSize` hook (shared by Task 6)

**Files:**
- Create: `src/hooks/useElementSize.ts`
- Create: `src/hooks/useElementSize.test.ts`

**Interfaces:**
- Produces: `useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number }` — `{0,0}` until the first ResizeObserver measurement (callers treat 0 as "unknown", never "tiny").

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useElementSize.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useElementSize } from "./useElementSize";

type ROCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;

let lastCallback: ROCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class MockResizeObserver {
  constructor(cb: ROCallback) {
    lastCallback = cb;
  }
  observe = observe;
  disconnect = disconnect;
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  lastCallback = null;
  observe.mockClear();
  disconnect.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useElementSize", () => {
  it("returns 0x0 before the first measurement", () => {
    const ref = createRef<HTMLElement | null>();
    (ref as { current: HTMLElement | null }).current = document.createElement("div");
    const { result } = renderHook(() => useElementSize(ref));
    expect(result.current).toEqual({ width: 0, height: 0 });
    expect(observe).toHaveBeenCalledOnce();
  });

  it("reports the latest observed content size", () => {
    const ref = createRef<HTMLElement | null>();
    (ref as { current: HTMLElement | null }).current = document.createElement("div");
    const { result } = renderHook(() => useElementSize(ref));
    act(() => {
      lastCallback!([{ contentRect: { width: 300, height: 180 } }]);
    });
    expect(result.current).toEqual({ width: 300, height: 180 });
  });

  it("disconnects on unmount", () => {
    const ref = createRef<HTMLElement | null>();
    (ref as { current: HTMLElement | null }).current = document.createElement("div");
    const { unmount } = renderHook(() => useElementSize(ref));
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- useElementSize`
Expected: FAIL — cannot resolve `./useElementSize`.

- [ ] **Step 3: Write the implementation**

```ts
// src/hooks/useElementSize.ts
import { useState, useEffect, type RefObject } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's content-box size via ResizeObserver. Returns {0, 0}
 * until the first measurement lands — callers should treat that as "size
 * unknown" (e.g. render the default layout), never as "tiny".
 */
export function useElementSize(
  ref: RefObject<HTMLElement | null>
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1].contentRect;
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- useElementSize`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useElementSize.ts src/hooks/useElementSize.test.ts
git commit -m "feat(hooks): useElementSize ResizeObserver hook"
```

---

### Task 6: Pomodoro compact mode (spec item 4)

**Files:**
- Modify: `src/components/terminal/PomodoroCell.tsx`
- Create: `src/components/terminal/PomodoroCell.test.tsx`

**Interfaces:**
- Consumes: `useElementSize` from Task 5.
- Props UNCHANGED.

**Behavior:** content area smaller than 240px wide **or** 200px tall (and measured, i.e. width > 0) renders the compact horizontal layout: `24:31  Focus  ▶ ⟳` row + full-width progress bar; no ring, no cycle dots, no duration editors. Otherwise the existing ring layout.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/terminal/PomodoroCell.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PomodoroCell } from "./PomodoroCell";
import type { PomodoroPane } from "../../types/pane";

vi.mock("../../hooks/useSounds", () => ({
  useSounds: () => ({ play: vi.fn() }),
}));
vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({ notify: vi.fn().mockResolvedValue(undefined) }),
}));

type ROCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;
let lastCallback: ROCallback | null = null;

class MockResizeObserver {
  constructor(cb: ROCallback) {
    lastCallback = cb;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  lastCallback = null;
});
afterEach(() => vi.unstubAllGlobals());

const pane: PomodoroPane = {
  id: "p1",
  label: "Pomodoro",
  color: "#06b6d4",
  workspaceId: "ws1",
  kind: "pomodoro",
  workMinutes: 25,
  breakMinutes: 5,
};

function renderCell() {
  return render(
    <PomodoroCell
      pane={pane}
      isActive={false}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onRename={vi.fn()}
      onSetDurations={vi.fn()}
      workspaces={[{ id: "ws1", name: "Workspace 1" }]}
      onMove={vi.fn()}
    />
  );
}

function resizeTo(width: number, height: number) {
  act(() => {
    lastCallback!([{ contentRect: { width, height } }]);
  });
}

describe("PomodoroCell responsive layout", () => {
  it("renders the ring layout at comfortable sizes", () => {
    const { container } = renderCell();
    resizeTo(400, 400);
    expect(container.querySelector("svg circle")).not.toBeNull();
    expect(screen.getByText("25:00")).toBeInTheDocument();
    expect(screen.getByLabelText(/focus/i)).toBeInTheDocument(); // duration input
  });

  it("renders the ring layout before the first measurement (0x0 = unknown)", () => {
    const { container } = renderCell();
    expect(container.querySelector("svg circle")).not.toBeNull();
  });

  it("switches to the compact bar layout when the pane is small", () => {
    const { container } = renderCell();
    resizeTo(200, 150);
    expect(container.querySelector("svg circle")).toBeNull();
    expect(screen.getByText("25:00")).toBeInTheDocument();
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(container.querySelector(".pomodoro-bar")).not.toBeNull();
    // No duration editors in compact mode.
    expect(screen.queryByLabelText(/focus/i)).toBeNull();
    // Controls still there (icon-only).
    expect(screen.getByTitle("Start")).toBeInTheDocument();
    expect(screen.getByTitle("Reset")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PomodoroCell`
Expected: FAIL — compact layout / `pomodoro-bar` / `Start` title don't exist yet. (If the ring-layout test also fails on `getByLabelText(/focus/i)`, wrap the existing duration `<label>` text check accordingly in Step 3 — the labels already contain the text "Focus"/"Break", so `getByLabelText` works once the `<label>` wraps the input, which it already does.)

- [ ] **Step 3: Implement the responsive branch**

In `src/components/terminal/PomodoroCell.tsx`:

1. Add imports:

```tsx
import { useState, useEffect, useRef } from "react";
import { useElementSize } from "../../hooks/useElementSize";
```

2. Inside the component, before `return`:

```tsx
const bodyRef = useRef<HTMLDivElement>(null);
const { width, height } = useElementSize(bodyRef);
// 0x0 means "not measured yet" — render the full layout, never flash compact.
const compact = width > 0 && (width < 240 || height < 200);
```

3. Restructure the body: keep `<PaneHeader …/>` as-is, then replace the current body `<div className="flex-1 …">…</div>` with a measured wrapper that branches:

```tsx
<div ref={bodyRef} className="flex-1 min-h-0 overflow-hidden">
  {compact ? (
    <div className="h-full flex flex-col justify-center gap-2 px-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xl font-semibold tabular-nums text-foreground">
          {fmt(left)}
        </span>
        <span
          className="text-[10px] uppercase tracking-widest truncate"
          style={{ color: ringColor }}
        >
          {state.phase === "focus" ? "Focus" : "Break"}
        </span>
        <div className="flex-1" />
        {running ? (
          <button
            title="Pause"
            onClick={(e) => {
              e.stopPropagation();
              setState((s) => pause(s, Date.now()));
            }}
            className="p-1.5 rounded-lg bg-white/5 text-foreground hover:bg-white/10"
          >
            <PauseIcon size={12} />
          </button>
        ) : (
          <button
            title="Start"
            onClick={(e) => {
              e.stopPropagation();
              setState((s) => start(s, Date.now()));
            }}
            className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
          >
            <Play size={12} />
          </button>
        )}
        <button
          title="Reset"
          onClick={(e) => {
            e.stopPropagation();
            setState((s) => reset(s, pane.workMinutes));
          }}
          className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-white/5"
        >
          <RotateCcw size={12} />
        </button>
      </div>
      <div className="pomodoro-bar h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${frac * 100}%`,
            background: ringColor,
            transition: "width 250ms linear",
          }}
        />
      </div>
    </div>
  ) : (
    <div className="h-full overflow-auto flex flex-col items-center justify-center gap-3 py-4">
      {/* …existing ring, cycle dots, controls, duration editors — moved
          verbatim from the old body, with the Start/Pause/Reset buttons
          gaining title="Start" / title="Pause" (Reset already has one)… */}
    </div>
  )}
</div>
```

Add `title="Start"` / `title="Pause"` to the existing full-layout buttons too (accessibility + shared test queries).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- PomodoroCell`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/terminal/PomodoroCell.tsx src/components/terminal/PomodoroCell.test.tsx
git commit -m "feat(pomodoro): compact horizontal layout for small panes"
```

---

### Task 7: Effort in SessionContext — Rust (spec item 8, backend)

**Files:**
- Modify: `src-tauri/src/session/types.rs` (add `effort`)
- Modify: `src-tauri/src/session/jsonl.rs` (parse effort from tail; settings fallback; unit tests)
- Modify: `src/types/session.ts` (add `effort`)

**Interfaces:**
- Produces: `SessionContext { tokens: u64, model: Option<String>, effort: Option<String> }` (TS: `{ tokens: number; model: string | null; effort: string | null }`).
- Produces (internal, unit-tested): `effort_from_line(data: &serde_json::Value) -> Option<String>` in `jsonl.rs`.

- [ ] **Step 1: Write the failing Rust tests**

Append to `src-tauri/src/session/jsonl.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn line(content: &str) -> serde_json::Value {
        serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": content }
        })
    }

    #[test]
    fn effort_parsed_from_effort_command_stdout() {
        let l = line(
            "<local-command-stdout>Set effort level to high (saved as your default for new sessions): Comprehensive implementation</local-command-stdout>"
        );
        assert_eq!(effort_from_line(&l), Some("high".to_string()));
    }

    #[test]
    fn effort_parsed_from_array_content() {
        let l = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": [
                { "type": "text", "text": "<local-command-stdout>Set effort level to max</local-command-stdout>" }
            ]}
        });
        assert_eq!(effort_from_line(&l), Some("max".to_string()));
    }

    #[test]
    fn effort_ignores_unrelated_lines() {
        assert_eq!(effort_from_line(&line("just chatting about effort levels")), None);
        let assistant = serde_json::json!({
            "type": "assistant",
            "message": { "content": "Set effort level to low" }
        });
        assert_eq!(effort_from_line(&assistant), None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test effort`
Expected: compile error — `effort_from_line` not found.

- [ ] **Step 3: Implement**

In `src-tauri/src/session/types.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct SessionContext {
    pub tokens: u64,
    pub model: Option<String>,
    /// Reasoning-effort level ("low"…"max"): the last `/effort` change recorded
    /// in the transcript tail, else the default from ~/.claude/settings.json.
    pub effort: Option<String>,
}
```

In `src-tauri/src/session/jsonl.rs`, add (above `get_session_context`):

```rust
/// Extract an effort level from a recorded `/effort` command's stdout. Claude
/// logs command output as user-type lines whose content contains
/// "Set effort level to <level>". Same scraping precedent as the
/// "Session renamed to:" detection in the frontend: display-only, tolerant of
/// surrounding text, and self-correcting on the next change.
fn effort_from_line(data: &serde_json::Value) -> Option<String> {
    if data.get("type").and_then(|t| t.as_str()) != Some("user") {
        return None;
    }
    let content = data.get("message")?.get("content")?;
    let text: String = if let Some(s) = content.as_str() {
        s.to_string()
    } else if let Some(arr) = content.as_array() {
        arr.iter()
            .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        return None;
    };
    let marker = "Set effort level to ";
    let idx = text.find(marker)?;
    let level: String = text[idx + marker.len()..]
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    if level.is_empty() {
        None
    } else {
        Some(level)
    }
}

/// The user's default effort level from ~/.claude/settings.json
/// (`"effortLevel"`), used when the transcript tail contains no `/effort`
/// change.
fn default_effort_level() -> Option<String> {
    let path = dirs::home_dir()?.join(".claude").join("settings.json");
    let data = fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&data).ok()?;
    json.get("effortLevel")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
```

In `get_session_context`, rework the scan loop to track effort and assemble at the end. Replace the `let mut latest…` loop and final `latest` with:

```rust
    let mut latest: Option<(u64, Option<String>)> = None;
    let mut effort: Option<String> = None;
    for line in buf[start..].lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let data: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(level) = effort_from_line(&data) {
            // Lines are append-ordered; the last change wins.
            effort = Some(level);
        }
        if data.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        if data
            .get("isSidechain")
            .and_then(|s| s.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let message = match data.get("message") {
            Some(m) => m,
            None => continue,
        };
        let tokens = match message.get("usage").and_then(context_tokens_from_usage) {
            Some(t) => t,
            None => continue,
        };
        let model = message
            .get("model")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string());
        latest = Some((tokens, model));
    }

    latest.map(|(tokens, model)| SessionContext {
        tokens,
        model,
        effort: effort.or_else(default_effort_level),
    })
```

In `src/types/session.ts`:

```ts
export interface SessionContext {
  /** Tokens resident in the context window (prompt + last output). */
  tokens: number;
  model: string | null;
  /** Reasoning-effort level ("low"…"max"), if known. */
  effort: string | null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: PASS (3 new tests + existing). Then `npx tsc --noEmit && npm test` — clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/session/types.rs src-tauri/src/session/jsonl.rs src/types/session.ts
git commit -m "feat(session): expose effort level in SessionContext"
```

---

### Task 8: Model · effort · tokens header pill (spec item 8, frontend)

**Files:**
- Modify: `src/lib/constants.ts` (add `formatModelShort`)
- Create: `src/lib/formatModelShort.test.ts`
- Modify: `src/components/terminal/ContextPill.tsx`
- Create: `src/components/terminal/ContextPill.test.tsx`
- Modify: `src/components/terminal/TerminalCell.tsx` (pass model/effort; container class)
- Modify: `src/styles/globals.css` (container queries + pill separators)

**Interfaces:**
- Consumes: `SessionContext.model` / `.effort` from Task 7.
- Produces: `formatModelShort(id: string): string`; `ContextPill` props `{ tokens: number; model?: string | null; effort?: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/formatModelShort.test.ts
import { describe, it, expect } from "vitest";
import { formatModelShort } from "./constants";

describe("formatModelShort", () => {
  it("formats current model ids", () => {
    expect(formatModelShort("claude-fable-5")).toBe("Fable 5");
    expect(formatModelShort("claude-opus-4-8")).toBe("Opus 4.8");
    expect(formatModelShort("claude-sonnet-5")).toBe("Sonnet 5");
  });

  it("drops a trailing date stamp", () => {
    expect(formatModelShort("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("tolerates a [1m] context suffix", () => {
    expect(formatModelShort("claude-fable-5[1m]")).toBe("Fable 5");
  });

  it("falls back to the raw id for unknown shapes", () => {
    expect(formatModelShort("gpt-oss-120b")).toBe("gpt-oss-120b");
  });
});
```

```tsx
// src/components/terminal/ContextPill.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextPill } from "./ContextPill";

describe("ContextPill", () => {
  it("shows tokens only when model/effort are absent", () => {
    const { container } = render(<ContextPill tokens={74_000} />);
    expect(screen.getByText("74k")).toBeInTheDocument();
    expect(container.querySelector(".pill-model")).toBeNull();
    expect(container.querySelector(".pill-effort")).toBeNull();
  });

  it("shows model and effort with discard-priority classes", () => {
    const { container } = render(
      <ContextPill tokens={74_000} model="claude-fable-5" effort="high" />
    );
    expect(screen.getByText("Fable 5")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(container.querySelector(".pill-model")).not.toBeNull();
    expect(container.querySelector(".pill-effort")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- formatModelShort ContextPill`
Expected: FAIL — `formatModelShort` not exported; `ContextPill` lacks props.

- [ ] **Step 3: Implement**

Append to `src/lib/constants.ts`:

```ts
/**
 * Short human name for a Claude model id: "claude-opus-4-8" → "Opus 4.8",
 * "claude-fable-5" → "Fable 5", "claude-haiku-4-5-20251001" → "Haiku 4.5"
 * (trailing date stamps dropped, "[1m]" context suffix tolerated). Unknown
 * shapes fall back to the raw id.
 */
export function formatModelShort(id: string): string {
  const m = id.replace(/\[1m\]$/, "").match(/^claude-([a-z]+)-([0-9][0-9-]*)$/);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  const parts = m[2].split("-").filter(Boolean);
  if (parts.length > 1 && /^\d{8}$/.test(parts[parts.length - 1])) {
    parts.pop();
  }
  return `${family} ${parts.join(".")}`;
}
```

Replace `src/components/terminal/ContextPill.tsx`:

```tsx
import { contextTier, formatTokens, formatModelShort } from "../../lib/constants";

interface ContextPillProps {
  tokens: number;
  model?: string | null;
  effort?: string | null;
}

/**
 * Compact header readout: "Fable 5 · high · 74k". Model and effort are muted
 * text; the token count keeps its severity-colored badge (green → red as the
 * context window fills). In narrow panes, container queries in globals.css
 * hide `.pill-effort` first and `.pill-model` second — tokens are always last
 * to go (and never do).
 */
export function ContextPill({ tokens, model, effort }: ContextPillProps) {
  const tier = contextTier(tokens);
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0 min-w-0">
      {model && (
        <span className="pill-model text-[10px] text-foreground-muted whitespace-nowrap">
          {formatModelShort(model)}
        </span>
      )}
      {effort && (
        <span className="pill-effort text-[10px] text-foreground-muted whitespace-nowrap">
          {effort}
        </span>
      )}
      <span
        className="px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums leading-none flex-shrink-0"
        style={{ color: tier.color, backgroundColor: tier.bg }}
        title={`${tier.label} — ${tokens.toLocaleString()} tokens in context`}
      >
        {formatTokens(tokens)}
      </span>
    </span>
  );
}
```

In `src/components/terminal/TerminalCell.tsx`:
- Root div: add the container class — `` className={`terminal-cell-container flex flex-col h-full min-h-0 bg-background ${…}`} ``
- Pill usage:

```tsx
{context && context.tokens > 0 && (
  <ContextPill
    tokens={context.tokens}
    model={context.model}
    effort={context.effort}
  />
)}
```

Append to `src/styles/globals.css` (after the terminal-container rules):

```css
/* Terminal cell header readout: "Fable 5 · high · 74k". The cell is a size
   container (its width is set by the canvas) so narrow panes can shed the
   readout in priority order: effort first, model second, tokens never. */
.terminal-cell-container {
  container-type: inline-size;
}
.pill-model::after,
.pill-effort::after {
  content: "·";
  margin-left: 6px;
  color: rgba(148, 163, 184, 0.5);
}
@container (max-width: 420px) {
  .pill-effort {
    display: none;
  }
}
@container (max-width: 340px) {
  .pill-model {
    display: none;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- formatModelShort ContextPill`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/constants.ts src/lib/formatModelShort.test.ts src/components/terminal/ContextPill.tsx src/components/terminal/ContextPill.test.tsx src/components/terminal/TerminalCell.tsx src/styles/globals.css
git commit -m "feat(terminal): show model and effort next to context tokens, responsively"
```

---

### Task 9: Session star store — Rust + IPC (spec item 5, backend)

**Files:**
- Modify: `src-tauri/src/workspace/store.rs` (stars store)
- Modify: `src-tauri/src/commands/workspace.rs` (command)
- Modify: `src-tauri/src/commands/session.rs` (overlay + pin + limit exemption, with tests)
- Modify: `src-tauri/src/session/types.rs` + `src-tauri/src/session/jsonl.rs` + `src-tauri/src/session/db.rs` (add `starred` field)
- Modify: `src-tauri/src/lib.rs` (register command)
- Modify: `src/lib/ipc.ts`, `src/types/session.ts`

**Interfaces:**
- Produces: Rust `store::get_session_stars() -> HashSet<String>`, `store::set_session_starred(session_id: String, starred: bool) -> Result<(), CockpitError>`; command `set_session_starred(session_id, starred)`.
- Produces: `SessionInfo.starred: bool`; sessions from `get_sessions` come starred-first, starred exempt from `limit`.
- Produces: TS `setSessionStarred(sessionId: string, starred: boolean): Promise<void>`; `Session.starred: boolean`.

- [ ] **Step 1: Write the failing Rust tests**

Append to `src-tauri/src/commands/session.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::types::SessionInfo;
    use std::collections::HashSet;

    fn session(id: &str, last_message: f64) -> SessionInfo {
        SessionInfo {
            session_id: id.to_string(),
            slug: None,
            first_message: 0.0,
            last_message,
            message_count: 1,
            tool_call_count: 0,
            cwd: "/tmp".to_string(),
            summary: None,
            model: None,
            git_branch: None,
            custom_title: None,
            first_user_message: None,
            starred: false,
        }
    }

    #[test]
    fn starred_sessions_pin_first_and_escape_the_limit() {
        let sessions = vec![
            session("new1", 400.0),
            session("new2", 300.0),
            session("old-starred", 100.0),
            session("old", 200.0),
        ];
        let stars: HashSet<String> = ["old-starred".to_string()].into();
        let result = pin_starred_and_limit(sessions, &stars, 2);
        let ids: Vec<&str> = result.iter().map(|s| s.session_id.as_str()).collect();
        // Starred first, then the 2 most recent unstarred; "old" dropped by limit.
        assert_eq!(ids, vec!["old-starred", "new1", "new2"]);
        assert!(result[0].starred);
        assert!(!result[1].starred);
    }

    #[test]
    fn unstarred_lists_sort_by_recency_and_truncate() {
        let sessions = vec![session("a", 100.0), session("b", 300.0), session("c", 200.0)];
        let result = pin_starred_and_limit(sessions, &HashSet::new(), 2);
        let ids: Vec<&str> = result.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c"]);
    }

    #[test]
    fn multiple_starred_sort_by_recency_within_the_pinned_group() {
        let sessions = vec![session("s1", 100.0), session("s2", 300.0), session("u", 200.0)];
        let stars: HashSet<String> = ["s1".to_string(), "s2".to_string()].into();
        let result = pin_starred_and_limit(sessions, &stars, 5);
        let ids: Vec<&str> = result.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s2", "s1", "u"]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test pin_starred`
Expected: compile error — `pin_starred_and_limit` and `starred` field don't exist.

- [ ] **Step 3: Implement the Rust side**

`src-tauri/src/session/types.rs` — add to `SessionInfo`:

```rust
    /// Cockpit-side star (session_stars.json overlay); never read from disk
    /// transcripts.
    pub starred: bool,
```

`src-tauri/src/session/jsonl.rs` — in `read_session_from_jsonl`'s `Some(SessionInfo { … })`, add `starred: false,`.
`src-tauri/src/session/db.rs` — in the row-mapping `SessionInfo { … }`, add `starred: false,`.
`src-tauri/src/commands/session.rs` — in the merge branch's `SessionInfo { … }`, add `starred: false,`.

`src-tauri/src/workspace/store.rs` — append (uses the existing `HashMap` import's sibling; add `use std::collections::HashSet;` at the top):

```rust
// --- Session stars ---------------------------------------------------------
// Starred sessions pin to the top of the sidebar and are exempt from the
// recency cap, so an important chat can be found (and its terminal safely
// closed) long after it stops being recent. Stored as a sorted JSON array of
// session ids, sibling to session_titles.json.

fn session_stars_file() -> PathBuf {
    base_dir().join("session_stars.json")
}

pub fn get_session_stars() -> HashSet<String> {
    let path = session_stars_file();
    if !path.exists() {
        return HashSet::new();
    }
    match fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
        Err(_) => HashSet::new(),
    }
}

pub fn set_session_starred(
    session_id: String,
    starred: bool,
) -> Result<(), crate::error::CockpitError> {
    let mut stars = get_session_stars();
    if starred {
        stars.insert(session_id);
    } else {
        stars.remove(&session_id);
    }
    let mut sorted: Vec<&String> = stars.iter().collect();
    sorted.sort();
    fs::write(session_stars_file(), serde_json::to_string_pretty(&sorted)?)?;
    Ok(())
}
```

`src-tauri/src/commands/workspace.rs` — append:

```rust
/// Star/unstar a session. Starred sessions pin to the top of the sidebar list
/// and never age out of it.
#[tauri::command]
pub fn set_session_starred(session_id: String, starred: bool) -> Result<(), CockpitError> {
    store::set_session_starred(session_id, starred)
}
```

`src-tauri/src/commands/session.rs` — add the pure helper and rewire `get_sessions`:

```rust
/// Overlay stars, sort by recency, pin starred sessions first, and apply the
/// limit to the unstarred remainder only — starred sessions never age out.
fn pin_starred_and_limit(
    mut sessions: Vec<SessionInfo>,
    stars: &std::collections::HashSet<String>,
    limit: usize,
) -> Vec<SessionInfo> {
    for s in sessions.iter_mut() {
        s.starred = stars.contains(&s.session_id);
    }
    sessions.sort_by(|a, b| {
        b.last_message
            .partial_cmp(&a.last_message)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let (mut starred, unstarred): (Vec<_>, Vec<_>) =
        sessions.into_iter().partition(|s| s.starred);
    starred.extend(unstarred.into_iter().take(limit));
    starred
}
```

In `get_sessions`, replace the current sort/truncate block:

```rust
    let mut result: Vec<SessionInfo> = session_map.into_values().collect();
    result.sort_by(|a, b| b.last_message.partial_cmp(&a.last_message).unwrap());
    result.truncate(limit as usize);
```

with:

```rust
    let result: Vec<SessionInfo> = session_map.into_values().collect();
    let stars = crate::workspace::store::get_session_stars();
    let mut result = pin_starred_and_limit(result, &stars, limit as usize);
```

(The title-override loop below stays, operating on the new `result`; keep it `mut` for that.)

Known bound (documented in the spec): the DB source queries with its own LIMIT, so a starred session only guaranteed-survives via the JSONL scan, which reads the whole project directory — the case that matters for per-project sidebar lists.

`src-tauri/src/lib.rs` — register after `set_session_title`:

```rust
            commands::workspace::set_session_starred,
```

- [ ] **Step 4: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: PASS (3 new + all existing).

- [ ] **Step 5: TS types + IPC**

`src/types/session.ts` — add to `Session`:

```ts
  starred: boolean;
```

`src/lib/ipc.ts` — after `setSessionTitle`:

```ts
/** Star/unstar a session: starred sessions pin to the top of the sidebar and
 *  never age out of the list. */
export const setSessionStarred = (sessionId: string, starred: boolean) =>
  invoke<void>("set_session_starred", { sessionId, starred });
```

- [ ] **Step 6: Verify everything**

Run: `npx tsc --noEmit && npm test && (cd src-tauri && cargo test)`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/workspace/store.rs src-tauri/src/commands/workspace.rs src-tauri/src/commands/session.rs src-tauri/src/session/types.rs src-tauri/src/session/jsonl.rs src-tauri/src/session/db.rs src-tauri/src/lib.rs src/lib/ipc.ts src/types/session.ts
git commit -m "feat(sessions): star store with pin-first, never-age-out semantics"
```

---

### Task 10: Star UI in the sidebar (spec item 5, frontend)

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `setSessionStarred` from Task 9; `Session.starred`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/layout/Sidebar.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { Session } from "../../types/session";

const sessions: Session[] = [
  {
    session_id: "s-starred",
    slug: null,
    first_message: 0,
    last_message: Date.now(),
    message_count: 3,
    tool_call_count: 0,
    cwd: "/tmp/proj",
    summary: null,
    model: null,
    git_branch: null,
    custom_title: "Important chat",
    first_user_message: null,
    starred: true,
  },
  {
    session_id: "s-plain",
    slug: null,
    first_message: 0,
    last_message: Date.now(),
    message_count: 1,
    tool_call_count: 0,
    cwd: "/tmp/proj",
    summary: null,
    model: null,
    git_branch: null,
    custom_title: "Plain chat",
    first_user_message: null,
    starred: false,
  },
];

vi.mock("../../lib/ipc", () => ({
  getSessions: vi.fn(async () => sessions),
  setSessionStarred: vi.fn(async () => undefined),
}));

import { getSessions, setSessionStarred } from "../../lib/ipc";

const project = {
  id: "p1",
  name: "proj",
  path: "/tmp/proj",
  color: "#06b6d4",
  terminals: 1,
  command: null,
};

function renderSidebar() {
  return render(
    <Sidebar
      projects={[project]}
      onLaunchProject={vi.fn()}
      onAddProject={vi.fn()}
      onEditProject={vi.fn()}
      onDeleteProject={vi.fn()}
      onReorderProjects={vi.fn()}
      onNewTerminal={vi.fn()}
      onNewNote={vi.fn()}
      onResumeSession={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.mocked(getSessions).mockClear();
  vi.mocked(setSessionStarred).mockClear();
});

describe("Sidebar session starring", () => {
  it("toggles a session's star over IPC", async () => {
    renderSidebar();
    fireEvent.click(screen.getByText("proj")); // expand
    await waitFor(() => expect(screen.getByText("Important chat")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Unstar")); // starred row shows Unstar
    expect(setSessionStarred).toHaveBeenCalledWith("s-starred", false);
  });

  it("stars an unstarred session", async () => {
    renderSidebar();
    fireEvent.click(screen.getByText("proj"));
    await waitFor(() => expect(screen.getByText("Plain chat")).toBeInTheDocument());
    const starButtons = screen.getAllByTitle("Star — keep pinned in this list");
    fireEvent.click(starButtons[0]);
    expect(setSessionStarred).toHaveBeenCalledWith("s-plain", true);
  });
});
```

Note: `Project.command` — check `src/types/project.ts` for the exact `Project` shape and adjust the fixture to it (the test must construct a valid `Project`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Sidebar`
Expected: FAIL — no element with title "Unstar".

- [ ] **Step 3: Implement the star UI**

In `src/components/layout/Sidebar.tsx`:

1. Add `Star` to the lucide import and `setSessionStarred` to the ipc import.
2. In `ProjectSection`, add a toggle handler after `loadSessions`:

```tsx
const toggleStar = useCallback(
  async (session: Session) => {
    // Optimistic flip; the 2.5s poll reconciles ordering and truth.
    setSessions((prev) =>
      prev.map((s) =>
        s.session_id === session.session_id ? { ...s, starred: !s.starred } : s
      )
    );
    try {
      await setSessionStarred(session.session_id, !session.starred);
    } catch (err) {
      console.error("Failed to toggle star:", err);
      loadSessions();
    }
  },
  [loadSessions]
);
```

3. Restructure the session row: the row `<button>` becomes a `<div className="relative group/session">` containing the resume button (add `pr-7` so text doesn't run under the star) plus an absolutely-positioned star button:

```tsx
sessions.map((session) => (
  <div key={session.session_id} className="relative group/session">
    <button
      onClick={() => {
        const sessionTitle = getDisplayTitle(session);
        const label = session.custom_title
          ? `${project.name}: ${session.custom_title}`
          : `${project.name}: ${sessionTitle.slice(0, 40)}`;
        onResume(session.session_id, session.cwd, label);
      }}
      className="w-full text-left px-2 py-1.5 pr-7 rounded-md hover:bg-white/5"
    >
      {/* …existing title + meta rows, verbatim… */}
    </button>
    <button
      onClick={(e) => {
        e.stopPropagation();
        toggleStar(session);
      }}
      title={session.starred ? "Unstar" : "Star — keep pinned in this list"}
      className={`absolute right-1 top-1.5 p-0.5 rounded hover:bg-white/10 ${
        session.starred
          ? "text-accent-amber"
          : "text-foreground-muted opacity-0 group-hover/session:opacity-100"
      }`}
    >
      <Star size={12} fill={session.starred ? "currentColor" : "none"} />
    </button>
  </div>
))
```

Backend ordering (starred pinned first) arrives via `getSessions` — no client-side sorting.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- Sidebar`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/components/layout/Sidebar.test.tsx
git commit -m "feat(sidebar): star sessions to pin them in the project list"
```

---

### Task 11: Character art — generation + mapping (spec item 7, assets)

> **Run this task in the main session (not a code subagent):** it shells out to the Codex CLI via the `codex-imagegen` skill.

**Files:**
- Create: `src/assets/player/<class>-t<1..5>.png` — 25 images, classes `archmage | artificer | duelist | berserker | adventurer`, tiers 1–5
- Modify: `src/lib/player.ts` (add `tierForLevel`, `nextMilestone`)
- Create: `src/lib/playerArt.ts`
- Create: `src/lib/playerArt.test.ts`

**Interfaces:**
- Produces: `tierForLevel(level: number): number` (1–5; levels 1–49 → 1, 50–99 → 2, 100–149 → 3, 150–199 → 4, 200+ → 5), `nextMilestone(level: number): number` (next multiple of `MILESTONE_EVERY` strictly above `level`), `artForPlayer(classKey: string, level: number): string` (bundled asset URL).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/playerArt.test.ts
import { describe, it, expect } from "vitest";
import { tierForLevel, nextMilestone, CLASSES } from "./player";
import { artForPlayer } from "./playerArt";

describe("tierForLevel", () => {
  it("maps level brackets to tiers 1-5", () => {
    expect(tierForLevel(1)).toBe(1);
    expect(tierForLevel(49)).toBe(1);
    expect(tierForLevel(50)).toBe(2);
    expect(tierForLevel(99)).toBe(2);
    expect(tierForLevel(100)).toBe(3);
    expect(tierForLevel(199)).toBe(4);
    expect(tierForLevel(200)).toBe(5);
    expect(tierForLevel(224)).toBe(5);
    expect(tierForLevel(9999)).toBe(5);
  });
});

describe("nextMilestone", () => {
  it("returns the next multiple of 25 strictly above the level", () => {
    expect(nextMilestone(1)).toBe(25);
    expect(nextMilestone(24)).toBe(25);
    expect(nextMilestone(25)).toBe(50);
    expect(nextMilestone(224)).toBe(225);
  });
});

describe("artForPlayer", () => {
  it("resolves an asset for every class x tier", () => {
    for (const key of Object.keys(CLASSES)) {
      for (const level of [1, 60, 120, 180, 250]) {
        const url = artForPlayer(key, level);
        expect(url, `${key} level ${level}`).toBeTruthy();
      }
    }
  });

  it("falls back to the adventurer art for unknown class keys", () => {
    expect(artForPlayer("nonsense", 10)).toBe(artForPlayer("adventurer", 10));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- playerArt`
Expected: FAIL — helpers and module missing.

- [ ] **Step 3: Add the pure helpers to player.ts**

Append to `src/lib/player.ts` (near `MILESTONE_EVERY`):

```ts
// --- Tiers ------------------------------------------------------------------
// Character art evolves in level brackets: 1-49, 50-99, 100-149, 150-199, 200+.
export const TIER_LEVEL_SPAN = 50;
export const MAX_TIER = 5;

export function tierForLevel(level: number): number {
  return Math.min(
    MAX_TIER,
    Math.max(1, Math.floor(Math.max(1, level) / TIER_LEVEL_SPAN) + 1)
  );
}

/** The next milestone level strictly above `level`. */
export function nextMilestone(level: number): number {
  return (Math.floor(level / MILESTONE_EVERY) + 1) * MILESTONE_EVERY;
}
```

Note `tierForLevel(49)`: `floor(49/50)+1 = 1`; `tierForLevel(50)`: `floor(50/50)+1 = 2`. Correct per bracket spec.

- [ ] **Step 4: Generate the 25 images**

Load the `codex-imagegen` skill (Skill tool) and follow its recipe. Requirements:

- Output: `src/assets/player/<classKey>-t<tier>.png`, square, 512×512 (downscale per the skill's web-weight guidance if it generates larger).
- Shared style across all 25: painterly dark sci-fi character portrait on a deep navy/slate glassy background (cockpit theme: `#0f172a` family), neon rim-light accents in cyan `#06b6d4` and violet `#8b5cf6`, centered bust portrait, no text in the image.
- Per class (keep one consistent character per class across its 5 tiers — use the skill's reference-image consistency technique, chaining t1 as reference for t2, etc.):
  - `archmage` — robed mage channeling glowing token-streams/glyphs.
  - `artificer` — goggled tinkerer with floating tools and gadget arms.
  - `duelist` — swift fencer with twin energy blades mid-flourish.
  - `berserker` — flame-wreathed warrior, wild energy aura.
  - `adventurer` — hooded explorer with a glowing compass.
- Tier escalation within each class: t1 plain novice gear → t2 sturdier kit → t3 ornate equipment, stronger glow → t4 radiant, crackling power → t5 legendary: golden accents, halo/aura, maximum spectacle.

After generation, verify: `ls src/assets/player | wc -l` → 25, and every file matches `^(archmage|artificer|duelist|berserker|adventurer)-t[1-5]\.png$`.

- [ ] **Step 5: Write the art mapper**

```ts
// src/lib/playerArt.ts
import { tierForLevel } from "./player";

// Every bundled portrait, keyed by its source path. Eager so a missing file
// fails tests at import time rather than rendering a broken <img> at runtime.
const images = import.meta.glob("../assets/player/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

function artPath(classKey: string, tier: number): string {
  return `../assets/player/${classKey}-t${tier}.png`;
}

/**
 * Bundled portrait URL for a class at a level. Unknown class keys fall back to
 * the adventurer portrait of the same tier.
 */
export function artForPlayer(classKey: string, level: number): string {
  const tier = tierForLevel(level);
  return images[artPath(classKey, tier)] ?? images[artPath("adventurer", tier)] ?? "";
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- playerArt`
Expected: PASS (4 tests — this also proves all 25 assets exist and resolve).

- [ ] **Step 7: Verify types and full suite, commit**

Run: `npx tsc --noEmit && npm test`

```bash
git add src/assets/player src/lib/player.ts src/lib/playerArt.ts src/lib/playerArt.test.ts
git commit -m "feat(player): class x tier character art with level-tier mapping"
```

---

### Task 12: Level-up burst overlay (spec item 7, celebration)

**Files:**
- Create: `src/components/player/LevelUpBurst.tsx`
- Modify: `src/hooks/usePlayer.ts` (flash durations 3000/5000)
- Modify: `src/components/player/PlayerHud.tsx` (render burst)
- Modify: `src/styles/globals.css` (burst animations)
- Create: `src/components/player/LevelUpBurst.test.tsx`

**Interfaces:**
- Consumes: `LevelUp` from `usePlayer`, `Player` from `player.ts`, `artForPlayer` from Task 11.
- Produces: `LevelUpBurst({ player, levelUp, onClick })` — portals a centered celebration card to `document.body`; `onClick` fires when the card is clicked (Task 13 wires it to the character modal).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/player/LevelUpBurst.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LevelUpBurst } from "./LevelUpBurst";
import { derivePlayer } from "../../lib/player";

const player = derivePlayer({
  outputTokens: 500_000_000,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  userMessages: 100,
  assistantMessages: 100,
  toolCalls: 100,
  sessions: 10,
  projects: 2,
});

describe("LevelUpBurst", () => {
  it("portals a centered card with level and class to document.body", () => {
    render(
      <LevelUpBurst
        player={player}
        levelUp={{ level: 225, milestone: false }}
        onClick={vi.fn()}
      />
    );
    const card = screen.getByText("LEVEL 225");
    expect(document.body.contains(card)).toBe(true);
    expect(screen.getByText(new RegExp(player.characterClass.name))).toBeInTheDocument();
    expect(screen.queryByText(/MILESTONE/)).toBeNull();
  });

  it("shows the milestone treatment for milestone levels", () => {
    render(
      <LevelUpBurst
        player={player}
        levelUp={{ level: 225, milestone: true }}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByText(/MILESTONE/)).toBeInTheDocument();
  });

  it("fires onClick when the card is clicked", () => {
    const onClick = vi.fn();
    render(
      <LevelUpBurst
        player={player}
        levelUp={{ level: 225, milestone: false }}
        onClick={onClick}
      />
    );
    fireEvent.click(screen.getByText("LEVEL 225"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- LevelUpBurst`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component + CSS**

```tsx
// src/components/player/LevelUpBurst.tsx
import { createPortal } from "react-dom";
import type { LevelUp } from "../../hooks/usePlayer";
import type { Player } from "../../lib/player";
import { artForPlayer } from "../../lib/playerArt";

interface LevelUpBurstProps {
  player: Player;
  levelUp: LevelUp;
  /** Opens the character card (the burst doubles as a shortcut to it). */
  onClick: () => void;
}

/**
 * Center-screen level-up celebration. Rendered while usePlayer's `levelUp` is
 * set (3s ordinary / 5s milestone) — mounting/unmounting is the parent's job.
 * The backdrop passes pointer events through; only the card itself is
 * clickable.
 */
export function LevelUpBurst({ player, levelUp, onClick }: LevelUpBurstProps) {
  const milestone = levelUp.milestone;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
      <button
        onClick={onClick}
        className={`pointer-events-auto levelup-burst flex flex-col items-center gap-3 px-10 py-8 rounded-2xl border backdrop-blur-xl ${
          milestone
            ? "levelup-milestone border-accent-amber/60 bg-background-secondary/90"
            : "border-accent-cyan/40 bg-background-secondary/90"
        }`}
      >
        <img
          src={artForPlayer(player.characterClass.key, levelUp.level)}
          alt={player.characterClass.name}
          className={`rounded-xl object-cover ${milestone ? "w-44 h-44" : "w-32 h-32"}`}
        />
        {milestone && (
          <div className="text-xs font-bold tracking-[0.3em] text-accent-amber">
            ⭐ MILESTONE ⭐
          </div>
        )}
        <div className="text-3xl font-bold text-foreground tabular-nums">
          LEVEL {levelUp.level}
        </div>
        <div className="text-sm text-foreground-muted">
          {player.characterClass.emoji} {player.characterClass.name}
        </div>
      </button>
    </div>,
    document.body
  );
}
```

Append to `src/styles/globals.css`:

```css
/* Level-up celebration card */
@keyframes levelup-pop {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  60% {
    transform: scale(1.05);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes levelup-glow {
  0%,
  100% {
    box-shadow: 0 0 40px rgba(6, 182, 212, 0.35), 0 24px 80px rgba(0, 0, 0, 0.6);
  }
  50% {
    box-shadow: 0 0 90px rgba(6, 182, 212, 0.6), 0 24px 80px rgba(0, 0, 0, 0.6);
  }
}
.levelup-burst {
  animation: levelup-pop 350ms cubic-bezier(0.2, 1.4, 0.4, 1) both,
    levelup-glow 1.6s ease-in-out infinite 350ms;
}
@keyframes levelup-glow-gold {
  0%,
  100% {
    box-shadow: 0 0 50px rgba(245, 158, 11, 0.45), 0 24px 80px rgba(0, 0, 0, 0.6);
  }
  50% {
    box-shadow: 0 0 110px rgba(245, 158, 11, 0.75), 0 24px 80px rgba(0, 0, 0, 0.6);
  }
}
.levelup-burst.levelup-milestone {
  animation: levelup-pop 450ms cubic-bezier(0.2, 1.4, 0.4, 1) both,
    levelup-glow-gold 1.4s ease-in-out infinite 450ms;
}
```

In `src/hooks/usePlayer.ts`, lengthen the flash windows to match the design:

```ts
const MILESTONE_FLASH_MS = 5000;
const LEVEL_FLASH_MS = 3000;
```

In `src/components/player/PlayerHud.tsx`, render the burst whenever a level-up is active. Minimal wiring for this task (Task 13 replaces the no-op click with the modal):

```tsx
import { LevelUpBurst } from "./LevelUpBurst";
// ...inside PlayerHud, restructure the returns so the burst renders in every
// levelUp branch:
return (
  <>
    {/* existing HUD / flash content, unchanged for now */}
    {levelUp && player && (
      <LevelUpBurst player={player} levelUp={levelUp} onClick={() => {}} />
    )}
  </>
);
```

Concretely: keep the three existing render branches but wrap each returned element in the fragment above so the burst accompanies both flash variants.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- LevelUpBurst`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify types and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/player/LevelUpBurst.tsx src/components/player/LevelUpBurst.test.tsx src/components/player/PlayerHud.tsx src/hooks/usePlayer.ts src/styles/globals.css
git commit -m "feat(player): center-screen level-up celebration burst"
```

---

### Task 13: Character card modal + clickable HUD (spec item 7, card)

**Files:**
- Create: `src/components/player/CharacterCard.tsx`
- Create: `src/components/player/CharacterCard.test.tsx`
- Modify: `src/components/player/PlayerHud.tsx` (clickable HUD, wire burst + modal)

**Interfaces:**
- Consumes: `Player`, `formatCompact`, `nextMilestone` from `player.ts`; `artForPlayer` from Task 11; `Modal` from `src/components/shared/Modal.tsx`.
- Produces: `CharacterCard({ player, open, onClose })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/player/CharacterCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CharacterCard } from "./CharacterCard";
import { derivePlayer, nextMilestone } from "../../lib/player";

const player = derivePlayer({
  outputTokens: 500_000_000,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  userMessages: 1000,
  assistantMessages: 1500,
  toolCalls: 2000,
  sessions: 50,
  projects: 4,
});

describe("CharacterCard", () => {
  it("shows level, class, XP and lifetime stats", () => {
    render(<CharacterCard player={player} open onClose={vi.fn()} />);
    expect(screen.getByText(`Level ${player.level}`)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(player.characterClass.name))
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Level ${nextMilestone(player.level)}`))
    ).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByAltText(player.characterClass.name)).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <CharacterCard player={player} open={false} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- CharacterCard`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the card**

```tsx
// src/components/player/CharacterCard.tsx
import { Modal } from "../shared/Modal";
import { formatCompact, nextMilestone, type Player } from "../../lib/player";
import { artForPlayer } from "../../lib/playerArt";

interface CharacterCardProps {
  player: Player;
  open: boolean;
  onClose: () => void;
}

/** One lifetime stat tile in the character card's grid. */
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-card-border px-3 py-2">
      <div className="text-sm font-semibold text-foreground tabular-nums">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-foreground-muted">
        {label}
      </div>
    </div>
  );
}

/**
 * The developer's character sheet: portrait, level, emergent class, XP
 * progress with exact numbers, and lifetime stats. Opened from the status-bar
 * HUD or by clicking a level-up burst.
 */
export function CharacterCard({ player, open, onClose }: CharacterCardProps) {
  const { level, xp, xpIntoLevel, xpForLevel, progress, characterClass, stats } =
    player;
  return (
    <Modal open={open} onClose={onClose} title="Character">
      <div className="flex flex-col items-center gap-4">
        <img
          src={artForPlayer(characterClass.key, level)}
          alt={characterClass.name}
          className="w-44 h-44 rounded-xl object-cover border border-card-border"
        />
        <div className="text-center">
          <div className="text-2xl font-bold text-foreground">
            Level {level}
          </div>
          <div className="text-sm text-foreground-muted">
            {characterClass.emoji} {characterClass.name} — {characterClass.blurb}
          </div>
        </div>

        <div className="w-full">
          <div className="flex justify-between text-xs text-foreground-muted mb-1 tabular-nums">
            <span>
              {xpIntoLevel.toLocaleString()} / {xpForLevel.toLocaleString()} XP
            </span>
            <span>{formatCompact(xp)} total</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-cyan"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-foreground-muted mt-1">
            Next milestone: Level {nextMilestone(level)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 w-full">
          <StatTile
            label="Output tokens"
            value={formatCompact(stats.outputTokens)}
          />
          <StatTile label="Messages" value={formatCompact(stats.userMessages)} />
          <StatTile label="Tool calls" value={formatCompact(stats.toolCalls)} />
          <StatTile label="Sessions" value={String(stats.sessions)} />
          <StatTile label="Projects" value={String(stats.projects)} />
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Make the HUD clickable and wire everything**

Replace `src/components/player/PlayerHud.tsx` with:

```tsx
import { useState } from "react";
import { usePlayer } from "../../hooks/usePlayer";
import { formatCompact } from "../../lib/player";
import { LevelUpBurst } from "./LevelUpBurst";
import { CharacterCard } from "./CharacterCard";

/**
 * Always-visible character HUD for the status bar: level, emergent class, and
 * an XP bar filling toward the next level. Click to open the full character
 * card. On a level-up the HUD flashes AND a center-screen burst celebrates
 * (see LevelUpBurst); milestone levels get the golden treatment.
 */
export function PlayerHud() {
  const { player, levelUp } = usePlayer();
  const [cardOpen, setCardOpen] = useState(false);
  if (!player) return null;

  const { level, characterClass, progress, xp } = player;
  const openCard = () => setCardOpen(true);

  return (
    <>
      <button
        onClick={openCard}
        title={`${characterClass.emoji} ${characterClass.name} — ${characterClass.blurb}\n${xp.toLocaleString()} XP total — click for character card`}
        className="rounded px-1 -mx-1 hover:bg-white/5 cursor-pointer"
      >
        {levelUp?.milestone ? (
          <div className="flex items-center gap-1.5 font-semibold text-accent-amber animate-pulse">
            <span>⭐ LEVEL {levelUp.level} — MILESTONE!</span>
          </div>
        ) : levelUp ? (
          <div className="flex items-center gap-1.5 font-semibold text-accent-cyan animate-pulse">
            <span>▲ Level {levelUp.level}!</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span>{characterClass.emoji}</span>
              <span className="font-semibold text-foreground">Lv {level}</span>
              <span className="text-foreground-muted">
                {characterClass.name}
              </span>
            </span>
            <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-cyan transition-[width] duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="tabular-nums">{formatCompact(xp)} XP</span>
          </div>
        )}
      </button>

      {levelUp && (
        <LevelUpBurst player={player} levelUp={levelUp} onClick={openCard} />
      )}
      <CharacterCard
        player={player}
        open={cardOpen}
        onClose={() => setCardOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- CharacterCard`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify types and full suite**

Run: `npx tsc --noEmit && npm test && (cd src-tauri && cargo test)`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add src/components/player/CharacterCard.tsx src/components/player/CharacterCard.test.tsx src/components/player/PlayerHud.tsx
git commit -m "feat(player): character card modal, clickable HUD"
```

---

## Final integration checklist (after all tasks)

- [ ] `npx tsc --noEmit` clean, `npm test` all green, `cd src-tauri && cargo test` all green.
- [ ] `git log --oneline main..HEAD` shows one commit per task.
- [ ] **Do NOT rebuild or relaunch the app.** Tell Kenneth the branch is ready; he rebuilds when he chooses.
- [ ] Update `docs/BACKLOG.md` only if it tracks any of these items (one-line done entries per backlog hygiene rules).
