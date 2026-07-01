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
  /** Ref to the scrollable surface, so the parent can measure it for arrange. */
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void;
  onClosePane: (id: string) => void;
  onRenamePane: (id: string, label: string) => void;
  onSessionRename: (id: string, sessionName: string) => void;
  onStatusChange: (id: string, status: TerminalStatus) => void;
  onExit: (id: string, code: number | null) => void;
}

// How far the canvas extends past the furthest window, so there's always room
// to drag a window outward (this is the "keep expanding" space).
const CANVAS_PADDING = 200;

type Gesture = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  orig: Rect;
};

/**
 * Free-form canvas surface: every pane (terminal or note) is an independently
 * positioned, draggable, resizable window. Drag a window by its header, resize
 * from the bottom-right handle. The surface grows past the viewport as windows
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
    mode: "move" | "resize"
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
        setRect(g.id, {
          ...g.orig,
          w: Math.max(MIN_W, g.orig.w + dx),
          h: Math.max(MIN_H, g.orig.h + dy),
        });
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
      </div>
    </div>
  );
}
