import { useState, useCallback } from "react";
import type React from "react";
import type { CSSProperties } from "react";
import { X, Pencil, Check, StickyNote } from "lucide-react";
import { NoteEditor } from "./NoteEditor";
import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";
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
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(note.label);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const { loaded, initialContent, onChange } = useNoteContent(note.id);

  const handleSubmitRename = useCallback(() => {
    if (editName.trim()) onRename(editName.trim());
    setEditing(false);
  }, [editName, onRename]);

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
      style={{ "--note-accent": note.color } as CSSProperties}
    >
      {/* Cell header */}
      <div
        onPointerDown={onHeaderPointerDown}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect();
          setMoveMenuOpen(true);
        }}
        className={`group flex items-center gap-2 px-2 py-1 border-b select-none backdrop-blur-md ${
          onHeaderPointerDown && !editing
            ? "cursor-grab active:cursor-grabbing"
            : ""
        } ${
          isActive
            ? "border-accent-cyan/30 bg-accent-cyan/5"
            : "border-card-border bg-background-secondary/30"
        }`}
      >
        <StickyNote
          size={12}
          className="flex-shrink-0"
          style={{ color: isActive ? note.color : undefined }}
        />

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
              style={{ color: isActive ? note.color : undefined }}
            >
              {note.label}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditName(note.label);
                setEditing(true);
              }}
              className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
              <Pencil size={10} />
            </button>
          </>
        )}

        <MoveToWorkspaceMenu
          currentWorkspaceId={note.workspaceId}
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
