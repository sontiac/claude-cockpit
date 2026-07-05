import type React from "react";
import type { CSSProperties } from "react";
import { StickyNote } from "lucide-react";
import { PaneHeader } from "./PaneHeader";
import { NoteEditor } from "./NoteEditor";
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
  const { loaded, initialContent, onChange } = useNoteContent(note.id);

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
      style={{ "--note-accent": note.color } as CSSProperties}
    >
      <PaneHeader
        icon={<StickyNote size={12} />}
        label={note.label}
        color={note.color}
        isActive={isActive}
        workspaceId={note.workspaceId}
        workspaces={workspaces}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onMove={onMove}
        onHeaderPointerDown={onHeaderPointerDown}
      />

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
