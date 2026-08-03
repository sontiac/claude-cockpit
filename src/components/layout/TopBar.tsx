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
