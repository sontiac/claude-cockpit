import { useState } from "react";
import { Plus, X, AppWindow } from "lucide-react";
import type { Workspace } from "../../types/terminal";

interface WorkspaceBarProps {
  workspaces: Workspace[];
  activeId: string;
  counts: Record<string, number>;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onNewWindow: () => void;
}

/**
 * Top bar of the terminal area: one tab per workspace (with its live terminal
 * count), an add button, and a "new window" button for multi-monitor use.
 * Double-click a tab to rename it.
 */
export function WorkspaceBar({
  workspaces,
  activeId,
  counts,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onNewWindow,
}: WorkspaceBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const beginRename = (ws: Workspace) => {
    setEditingId(ws.id);
    setDraft(ws.name);
  };
  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-background-secondary/20 backdrop-blur-xl border-b border-white/10 overflow-x-auto">
      {workspaces.map((ws) => {
        const active = ws.id === activeId;
        const count = counts[ws.id] ?? 0;
        return (
          <div
            key={ws.id}
            onClick={() => onSwitch(ws.id)}
            onDoubleClick={() => beginRename(ws)}
            className={`group/ws flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg cursor-pointer flex-shrink-0 border transition-colors ${
              active
                ? "bg-white/10 border-white/15 text-foreground"
                : "border-transparent text-foreground-muted hover:text-foreground hover:bg-white/5"
            }`}
            title="Double-click to rename"
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

      <div className="flex-1" />

      <button
        onClick={onNewWindow}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-foreground-muted hover:text-foreground hover:bg-white/5 flex-shrink-0"
        title="Open a new window (for a second monitor)"
      >
        <AppWindow size={13} />
        New Window
      </button>
    </div>
  );
}
