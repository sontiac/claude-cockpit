# Move Pane to Workspace + "Columns" Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any canvas pane (terminal or note) be moved to another workspace via a header button + right-click inline menu, and add a "Columns" arrange preset that lays every pane out as a full-height column.

**Architecture:** Two small hook methods (`moveTerminal`, `moveNote`) plus an `App`-level `movePane` router mirror the existing `rename`/`renamePane` pattern. A shared, controlled `MoveToWorkspaceMenu` popover is rendered in both cell headers; `workspaces` + `onMovePane` thread through `TerminalGrid → TerminalCanvas → cells`. The "Columns" preset reuses the existing `arrange(n)` with `n = pane count` (no new tiling math).

**Tech Stack:** React 19, TypeScript, Vitest, lucide-react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-01-pane-move-and-columns-design.md`

## Global Constraints

- `noUnusedLocals` / `noUnusedParameters` are ON: never add a symbol/param without using it in the same task (returning a function from a hook counts as use).
- Move applies to ANY pane (terminal + note); after a move the user STAYS on the current workspace (no auto-follow).
- The move button is HIDDEN when there is no other workspace to move to.
- Right-click on a pane header opens the move menu (`preventDefault` the OS menu); a right-click must NOT start a drag.
- "Columns" = `arrange(panes.length)` — reuse existing `tileRects`; no new geometry function.
- Typecheck floor: `npm run build` (tsc + vite) passes; existing tests stay green; new tests pristine.
- Frequent commits, existing message style.

---

## File Structure

**Created:**
- `src/components/terminal/MoveToWorkspaceMenu.tsx` — shared controlled popover listing target workspaces.
- `src/hooks/useCanvasLayout.test.ts` — locks the Columns tiling math.

**Modified:**
- `src/hooks/useTerminals.ts` — add `moveTerminal`, export it.
- `src/hooks/useNotes.ts` — add `moveNote`, export it.
- `src/hooks/useNotes.test.ts` — add a `moveNote` test.
- `src/components/terminal/TerminalCell.tsx` — render the menu + `onContextMenu`; new props `workspaces`, `onMove`.
- `src/components/terminal/NoteCell.tsx` — same.
- `src/components/terminal/TerminalCanvas.tsx` — thread `workspaces`/`onMovePane`; drag-guard `e.button !== 0`.
- `src/components/terminal/TerminalGrid.tsx` — thread `workspaces`/`onMovePane`; add "Columns" button.
- `src/App.tsx` — add `movePane` router; pass `workspaces`/`onMovePane` to `TerminalGrid`.

---

## Task 1: Move methods on the hooks

**Files:**
- Modify: `src/hooks/useTerminals.ts`, `src/hooks/useNotes.ts`
- Test: `src/hooks/useNotes.test.ts`

**Interfaces:**
- Produces:
  - `useTerminals().moveTerminal(id: string, workspaceId: string): void`
  - `useNotes().moveNote(id: string, workspaceId: string): void`

- [ ] **Step 1: Add a failing `moveNote` test**

In `src/hooks/useNotes.test.ts`, add this test inside the top-level `describe("useNotes", ...)` block (after the existing `reassignNotes` test):

```ts
  it("moves a single note to another workspace, leaving others", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let a = "";
    let b = "";
    act(() => {
      a = result.current.addNote("ws-1").id;
      b = result.current.addNote("ws-1").id;
    });
    act(() => result.current.moveNote(a, "ws-2"));

    const moved = result.current.notes.find((n) => n.id === a);
    const other = result.current.notes.find((n) => n.id === b);
    expect(moved?.workspaceId).toBe("ws-2");
    expect(other?.workspaceId).toBe("ws-1");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- useNotes`
Expected: FAIL — `result.current.moveNote is not a function`.

- [ ] **Step 3: Implement `moveNote` in `useNotes.ts`**

In `src/hooks/useNotes.ts`, add this callback next to `renameNote` (which reads `setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, label } : n)));`):

```ts
  const moveNote = useCallback((id: string, workspaceId: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, workspaceId } : n))
    );
  }, []);
```

Then add `moveNote` to the hook's return object. Change:

```ts
  return { notes, addNote, renameNote, removeNote, reassignNotes, discardNotes };
```
to:
```ts
  return {
    notes,
    addNote,
    renameNote,
    moveNote,
    removeNote,
    reassignNotes,
    discardNotes,
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- useNotes`
Expected: PASS (7 tests now).

- [ ] **Step 5: Implement `moveTerminal` in `useTerminals.ts`**

In `src/hooks/useTerminals.ts`, add next to `rename` (which is `const rename = useCallback((id, label) => setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t))), []);`):

```ts
  const moveTerminal = useCallback((id: string, workspaceId: string) => {
    setTerminals((prev) =>
      prev.map((t) => (t.id === id ? { ...t, workspaceId } : t))
    );
  }, []);
```

Then add `moveTerminal,` to the hook's big `return { ... }` object (place it after `rename,`).

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run build && npm test`
Expected: build clean; all tests pass (moveTerminal is now exported/used-on-return so no unused error; App doesn't consume it yet, which is fine).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useTerminals.ts src/hooks/useNotes.ts src/hooks/useNotes.test.ts
git commit -m "feat(canvas): moveTerminal/moveNote hook methods"
```

---

## Task 2: MoveToWorkspaceMenu component

**Files:**
- Create: `src/components/terminal/MoveToWorkspaceMenu.tsx`

**Interfaces:**
- Consumes: `Workspace` from `../../types/terminal`.
- Produces:
  ```ts
  MoveToWorkspaceMenu(props: {
    currentWorkspaceId: string;
    workspaces: Workspace[];
    onMove: (workspaceId: string) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }): JSX.Element | null
  ```
  Returns `null` when there are no other workspaces. Controlled open state (so a header right-click can open it too).

- [ ] **Step 1: Create the component**

Create `src/components/terminal/MoveToWorkspaceMenu.tsx`:

```tsx
import { useRef, useEffect } from "react";
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
 */
export function MoveToWorkspaceMenu({
  currentWorkspaceId,
  workspaces,
  onMove,
  open,
  onOpenChange,
}: MoveToWorkspaceMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const targets = workspaces.filter((w) => w.id !== currentWorkspaceId);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  if (targets.length === 0) return null;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        title="Move to workspace"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100"
      >
        <FolderInput size={11} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 min-w-[10rem] rounded-md border border-card-border bg-background-secondary/95 backdrop-blur-xl shadow-lg py-1">
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
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: passes (the module is not imported yet — that's fine; nothing inside it is unused).

- [ ] **Step 3: Commit**

```bash
git add src/components/terminal/MoveToWorkspaceMenu.tsx
git commit -m "feat(canvas): MoveToWorkspaceMenu popover component"
```

---

## Task 3: Wire the move feature end to end

**Files:**
- Modify: `src/components/terminal/TerminalCell.tsx`, `src/components/terminal/NoteCell.tsx`, `src/components/terminal/TerminalCanvas.tsx`, `src/components/terminal/TerminalGrid.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `MoveToWorkspaceMenu` (Task 2); `moveTerminal`/`moveNote` (Task 1); `Workspace` type.
- Produces: `TerminalGrid`/`TerminalCanvas` gain props `workspaces: Workspace[]` and `onMovePane: (id: string, workspaceId: string) => void`; `TerminalCell`/`NoteCell` gain `workspaces: Workspace[]` and `onMove: (workspaceId: string) => void`.

- [ ] **Step 1: Add the menu to `TerminalCell.tsx`**

Add imports at the top (extend the existing lucide import line and add the menu + type):

```tsx
import { useState, useCallback } from "react";
```
becomes
```tsx
import { useState, useCallback } from "react";
import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";
import type { Workspace } from "../../types/terminal";
```

Add two props to `TerminalCellProps` (after `onHeaderPointerDown?`):

```tsx
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
```

Destructure them in the component signature (add `workspaces,` and `onMove,`), and add a local open state near `const [editing, setEditing] = useState(false);`:

```tsx
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
```

Add `onContextMenu` to the header `div` (the one with `onPointerDown={onHeaderPointerDown}`), right after that attribute:

```tsx
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect();
          setMoveMenuOpen(true);
        }}
```

Render the menu inside the header, immediately BEFORE the close button (`<button ... onClick={... onClose() ...}> <X size={12} /> </button>`):

```tsx
        <MoveToWorkspaceMenu
          currentWorkspaceId={terminal.workspaceId}
          workspaces={workspaces}
          onMove={onMove}
          open={moveMenuOpen}
          onOpenChange={setMoveMenuOpen}
        />
```

- [ ] **Step 2: Add the menu to `NoteCell.tsx`**

Mirror Step 1 in `src/components/terminal/NoteCell.tsx`:
- Add imports `import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";` and `import type { Workspace } from "../../types/terminal";`.
- Add props `workspaces: Workspace[];` and `onMove: (workspaceId: string) => void;` to `NoteCellProps`; destructure them.
- Add `const [moveMenuOpen, setMoveMenuOpen] = useState(false);` near the existing `editing` state.
- Add the same `onContextMenu` handler to the header `div` (uses `onSelect()` + `setMoveMenuOpen(true)`).
- Render `<MoveToWorkspaceMenu currentWorkspaceId={note.workspaceId} workspaces={workspaces} onMove={onMove} open={moveMenuOpen} onOpenChange={setMoveMenuOpen} />` immediately before the close button.

- [ ] **Step 3: Thread props through `TerminalCanvas.tsx` + add the drag-guard**

In `src/components/terminal/TerminalCanvas.tsx`:

Add to `TerminalCanvasProps` (after `onRenamePane`):

```tsx
  workspaces: Workspace[];
  onMovePane: (id: string, workspaceId: string) => void;
```

Add the type import: `import type { Workspace } from "../../types/terminal";` (there's already a `TerminalStatus` import from `../../types/terminal` — extend it or add a line). Destructure `workspaces,` and `onMovePane,` in the component signature.

Guard the header drag against non-left buttons. Find the `headerPointerDown` handler:

```tsx
          const headerPointerDown = (e: React.PointerEvent) => {
            if ((e.target as HTMLElement).closest("button, input")) return;
            onSelect(pane.id);
            startGesture(e, pane.id, "move");
          };
```
Change its first line to add the guard:
```tsx
          const headerPointerDown = (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button, input")) return;
            onSelect(pane.id);
            startGesture(e, pane.id, "move");
          };
```

Pass the new props to BOTH cells. In the `<TerminalCell ... />` block add:
```tsx
                  workspaces={workspaces}
                  onMove={(wsId) => onMovePane(pane.id, wsId)}
```
and in the `<NoteCell ... />` block add the same two lines.

- [ ] **Step 4: Thread props through `TerminalGrid.tsx`**

In `src/components/terminal/TerminalGrid.tsx`:

Add to `TerminalGridProps` (after `onNewNote`):
```tsx
  workspaces: Workspace[];
  onMovePane: (id: string, workspaceId: string) => void;
```
Add the type import `import type { Workspace } from "../../types/terminal";` (there is already a `TerminalStatus` import from that module). Destructure `workspaces,` and `onMovePane,`.

Pass them down to `<TerminalCanvas ... />` (add after `onRenamePane={onRenamePane}`):
```tsx
        workspaces={workspaces}
        onMovePane={onMovePane}
```

- [ ] **Step 5: Add the `movePane` router in `App.tsx` and pass props to the grid**

In `src/App.tsx`:

Destructure `moveTerminal` from `useTerminals()` (add to its destructure block) and `moveNote` from `useNotes()` (add to its destructure block).

Add a `movePane` router next to the existing `renamePane` (`const renamePane = useCallback((id, label) => { if (notes.some((n) => n.id === id)) renameNote(id, label); else rename(id, label); }, [notes, renameNote, rename]);`):

```tsx
  const movePane = useCallback(
    (id: string, workspaceId: string) => {
      if (notes.some((n) => n.id === id)) moveNote(id, workspaceId);
      else moveTerminal(id, workspaceId);
    },
    [notes, moveNote, moveTerminal]
  );
```

Pass the two new props to `<TerminalGrid ... />` (add after `onNewNote={() => handleNewNote(ws.id)}`):

```tsx
                    workspaces={workspaces}
                    onMovePane={movePane}
```

- [ ] **Step 6: Typecheck + tests**

Run: `npm run build && npm test`
Expected: build clean (zero errors — proves every new prop is used and the whole chain type-checks); all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/terminal/TerminalCell.tsx src/components/terminal/NoteCell.tsx src/components/terminal/TerminalCanvas.tsx src/components/terminal/TerminalGrid.tsx src/App.tsx
git commit -m "feat(canvas): move pane to workspace via header button + right-click"
```

---

## Task 4: "Columns" arrange preset

**Files:**
- Modify: `src/components/terminal/TerminalGrid.tsx`
- Test: `src/hooks/useCanvasLayout.test.ts`

**Interfaces:**
- Consumes: existing `tileRects(ids, cols, viewportW, viewportH)` and `arrange(cols)`.

- [ ] **Step 1: Write a failing test locking the Columns tiling**

Create `src/hooks/useCanvasLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tileRects, MIN_H } from "./useCanvasLayout";

describe("tileRects columns preset (cols = n)", () => {
  it("lays every pane into a single full-height row", () => {
    const ids = ["a", "b", "c", "d"];
    const rects = tileRects(ids, ids.length, 1000, 600);

    // One row: every rect shares the same y (the top margin).
    const ys = ids.map((id) => rects[id].y);
    expect(new Set(ys).size).toBe(1);

    // x strictly increasing left-to-right.
    const xs = ids.map((id) => rects[id].x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }

    // Full-height columns: each rect is (near) the full viewport height, and at
    // least MIN_H.
    for (const id of ids) {
      expect(rects[id].h).toBeGreaterThanOrEqual(MIN_H);
      // 600 viewport minus top+bottom margins (20 each) = 560, single row.
      expect(rects[id].h).toBe(560);
    }
  });

  it("degenerates to a single full-viewport pane for one id", () => {
    const rects = tileRects(["only"], 1, 800, 500);
    expect(rects["only"].y).toBe(20);
    expect(rects["only"].h).toBe(460); // 500 - 2*20
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (tileRects already supports this)**

Run: `npm test -- useCanvasLayout`
Expected: PASS — this test documents/locks existing `tileRects` behavior (`cols = n` → one row). If it FAILS, stop: the geometry assumption behind the Columns preset is wrong and must be reconciled before adding the button.

- [ ] **Step 3: Add the "Columns" button to `TerminalGrid.tsx`**

Extend the lucide import to include `Columns3`:
```tsx
import { Plus, LayoutGrid, StickyNote } from "lucide-react";
```
becomes
```tsx
import { Plus, LayoutGrid, StickyNote, Columns3 } from "lucide-react";
```

In the toolbar's arrange group, add a Columns button immediately AFTER the auto-grid (`LayoutGrid`) button and BEFORE the `{[1, 2, 3].map(...)}` block:

```tsx
          <button
            onClick={() => arrange(panes.length)}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5 transition-colors"
            title="Fit all as full-height columns"
          >
            <Columns3 size={14} />
          </button>
```

(`arrange` and `panes` are already in scope in this component.)

- [ ] **Step 4: Typecheck + tests**

Run: `npm run build && npm test`
Expected: build clean; all tests pass (including the new `useCanvasLayout` tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/terminal/TerminalGrid.tsx src/hooks/useCanvasLayout.test.ts
git commit -m "feat(canvas): Columns arrange preset (full-height columns)"
```

---

## Task 5: Manual verification

**Files:** none.

> **IMPORTANT (project rule):** Do not launch the app — the user runs it live. Hand this checklist to the user.

- [ ] **Step 1: Verify checklist (hand to the user)**

1. Hover a terminal or note header → a "move" (folder-in) icon appears next to the close button; clicking it opens a popover of the *other* workspaces.
2. Right-click a pane header → the same popover opens (no OS context menu, and no drag starts).
3. Click a workspace in the popover → the pane leaves the current workspace and appears in that one; you stay on the current workspace. The workspace tab counts update.
4. With only one workspace, the move button/menu does not appear.
5. Moving works for both terminals and notes; a moved note keeps its content.
6. The "Columns" toolbar button lays every pane out as full-height columns side by side; with many panes they get narrow and the canvas scrolls horizontally. Panes remain draggable/resizable afterward.

- [ ] **Step 2: Merge** — use `superpowers:finishing-a-development-branch`.

---

## Self-Review Notes

- **Spec coverage:** move-any-pane (Tasks 1/3), header button + right-click (Task 3), inline popover (Task 2), hidden when no other workspace (Task 2 `targets.length === 0`), stay-put/no-follow (router does only the move — Task 3), drag-guard for right-click (Task 3 Step 3), Columns preset via `arrange(n)` (Task 4), tests for `moveNote` + `tileRects` columns (Tasks 1/4), `moveTerminal` intentionally untested (noted). All covered.
- **Type consistency:** `moveTerminal(id, workspaceId)` / `moveNote(id, workspaceId)` / `movePane(id, workspaceId)` / `onMovePane(id, workspaceId)` / `onMove(workspaceId)` are consistent across tasks; `MoveToWorkspaceMenu` props (`currentWorkspaceId`, `workspaces`, `onMove`, `open`, `onOpenChange`) match its call sites in both cells; `Workspace` imported from `../../types/terminal` everywhere.
- **noUnusedLocals/Parameters:** every new prop/param is consumed in the same task that introduces it; `moveTerminal` is used via the hook return in Task 1 and consumed by `App` in Task 3.
