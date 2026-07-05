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
