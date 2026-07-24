import { useMemo, useRef } from "react";
import type React from "react";
import { TerminalCell } from "./TerminalCell";
import { NoteCell } from "./NoteCell";
import { MarkdownViewerCell } from "./MarkdownViewerCell";
import { PomodoroCell } from "./PomodoroCell";
import {
  resizeRect,
  type Rect,
  type ResizeEdge,
} from "../../hooks/useCanvasLayout";
import type { Pane } from "../../types/pane";
import type { TerminalStatus, Workspace } from "../../types/terminal";

interface TerminalCanvasProps {
  panes: Pane[];
  activeId: string | null;
  layout: Record<string, Rect>;
  setRect: (id: string, rect: Rect) => void;
  /** Ref to the scrollable surface, so the parent can measure it for arrange
   *  and track its size (a callback ref — the parent holds the element in
   *  state so observation survives unmount/remount). */
  surfaceRef: React.Ref<HTMLDivElement>;
  onSelect: (id: string) => void;
  onClosePane: (id: string) => void;
  onRenamePane: (id: string, label: string) => void;
  onSessionRename: (id: string, sessionName: string) => void;
  onStatusChange: (id: string, status: TerminalStatus) => void;
  onExit: (id: string, code: number | null) => void;
  onSetPanePath: (id: string, path: string | null) => void;
  onSetPomodoroDurations: (id: string, workMinutes: number, breakMinutes: number) => void;
  workspaces: Workspace[];
  onMovePane: (id: string, workspaceId: string) => void;
}

// How far the canvas extends past the furthest window, so there's always room
// to drag a window outward (this is the "keep expanding" space).
const CANVAS_PADDING = 200;

type Gesture = {
  id: string;
  mode: "move" | ResizeEdge;
  startX: number;
  startY: number;
  orig: Rect;
};

// Hit areas for resizing: thin strips along each edge plus larger corner
// squares (corners win — they're separate elements rendered after the edges).
// Edge strips are inset by the corner size so the two never overlap.
const RESIZE_HANDLES: { edge: ResizeEdge; className: string }[] = [
  { edge: "n", className: "top-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { edge: "s", className: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { edge: "w", className: "left-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "e", className: "right-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "nw", className: "top-0 left-0 w-3 h-3 cursor-nwse-resize" },
  { edge: "ne", className: "top-0 right-0 w-3 h-3 cursor-nesw-resize" },
  { edge: "sw", className: "bottom-0 left-0 w-3 h-3 cursor-nesw-resize" },
];

/**
 * Free-form canvas surface: every pane (terminal or note) is an independently
 * positioned, draggable, resizable window. Drag a window by its header, resize
 * from any edge or corner. The surface grows past the viewport as windows
 * are moved outward, so the workspace can keep expanding.
 *
 * Geometry is owned by the parent (TerminalGrid) so its toolbar can re-tile all
 * windows at once. The surface is intentionally generic about what it positions.
 */
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
  onSetPanePath,
  onSetPomodoroDurations,
  workspaces,
  onMovePane,
}: TerminalCanvasProps) {
  const ids = useMemo(() => panes.map((p) => p.id), [panes]);
  const gestureRef = useRef<Gesture | null>(null);

  // Size the surface to contain every window plus padding, but never smaller
  // than the viewport (min-w/h-full handles the floor in CSS).
  const extent = useMemo(() => {
    let right = 0;
    let bottom = 0;
    for (const id of ids) {
      const r = layout[id];
      if (!r) continue;
      right = Math.max(right, r.x + r.w);
      bottom = Math.max(bottom, r.y + r.h);
    }
    return { width: right + CANVAS_PADDING, height: bottom + CANVAS_PADDING };
  }, [ids, layout]);

  const startGesture = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | ResizeEdge
  ) => {
    const orig = layout[id];
    if (!orig) return;
    gestureRef.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig,
    };

    const onMove = (ev: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const dx = ev.clientX - g.startX;
      const dy = ev.clientY - g.startY;
      if (g.mode === "move") {
        setRect(g.id, {
          ...g.orig,
          x: Math.max(0, g.orig.x + dx),
          y: Math.max(0, g.orig.y + dy),
        });
      } else {
        setRect(g.id, resizeRect(g.orig, g.mode, dx, dy));
      }
    };
    const onUp = () => {
      gestureRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Suppress text selection while dragging across the canvas / terminals.
    document.body.style.userSelect = "none";
  };

  return (
    <div ref={surfaceRef} className="flex-1 min-h-0 overflow-auto bg-black/10">
      <div
        className="relative min-w-full min-h-full"
        style={{ width: extent.width, height: extent.height }}
      >
        {panes.map((pane) => {
          const rect = layout[pane.id];
          if (!rect) return null;
          const isActive = pane.id === activeId;
          const headerPointerDown = (e: React.PointerEvent) => {
            if (e.button !== 0) return;
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
              {/* Invisible resize hit areas on every edge and corner. */}
              {RESIZE_HANDLES.map(({ edge, className }) => (
                <div
                  key={edge}
                  data-resize-edge={edge}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(pane.id);
                    startGesture(e, pane.id, edge);
                  }}
                  className={`absolute z-30 ${className}`}
                />
              ))}
              {/* Bottom-right keeps its visible grip as the affordance. */}
              <div
                data-resize-edge="se"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(pane.id);
                  startGesture(e, pane.id, "se");
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
      </div>
    </div>
  );
}
