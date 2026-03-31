import { useState, useCallback } from "react";
import { X, Pencil, Check } from "lucide-react";
import { StatusDot } from "../shared/StatusDot";
import { TerminalPanel } from "./TerminalPanel";
import type { TerminalInfo, TerminalStatus } from "../../types/terminal";

interface TerminalCellProps {
  terminal: TerminalInfo;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onStatusChange: (status: TerminalStatus) => void;
  onExit: (code: number | null) => void;
}

export function TerminalCell({
  terminal,
  isActive,
  onSelect,
  onClose,
  onRename,
  onStatusChange,
  onExit,
}: TerminalCellProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(terminal.label);

  const handleSubmitRename = useCallback(() => {
    if (editName.trim()) {
      onRename(editName.trim());
    }
    setEditing(false);
  }, [editName, onRename]);

  return (
    <div
      className={`flex flex-col min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
    >
      {/* Cell header */}
      <div
        className={`flex items-center gap-2 px-2 py-1 border-b select-none ${
          isActive
            ? "border-accent-cyan/30 bg-accent-cyan/5"
            : "border-card-border bg-background-secondary/30"
        }`}
      >
        <StatusDot status={terminal.status} />

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
              style={{ color: isActive ? terminal.color : undefined }}
            >
              {terminal.label}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditName(terminal.label);
                setEditing(true);
              }}
              className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
              <Pencil size={10} />
            </button>
          </>
        )}

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

      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <TerminalPanel
          id={terminal.id}
          active={true}
          onStatusChange={onStatusChange}
          onExit={onExit}
        />
      </div>
    </div>
  );
}
