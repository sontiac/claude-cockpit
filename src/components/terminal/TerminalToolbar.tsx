import { useState } from "react";
import { Pencil, Trash2, Check } from "lucide-react";
import type { TerminalInfo } from "../../types/terminal";

interface TerminalToolbarProps {
  terminal: TerminalInfo;
  onRename: (label: string) => void;
  onKill: () => void;
}

export function TerminalToolbar({
  terminal,
  onRename,
  onKill,
}: TerminalToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(terminal.label);

  const handleSubmit = () => {
    if (name.trim()) {
      onRename(name.trim());
    }
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-background-secondary/50 border-b border-card-border">
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="bg-white/5 border border-card-border rounded px-2 py-0.5 text-sm text-foreground outline-none focus:border-accent-cyan"
          />
          <button
            onClick={handleSubmit}
            className="p-1 rounded hover:bg-white/10 text-accent-cyan"
          >
            <Check size={14} />
          </button>
        </div>
      ) : (
        <>
          <span className="text-sm text-foreground-muted">
            {terminal.label}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground"
            title="Rename"
          >
            <Pencil size={12} />
          </button>
        </>
      )}

      <div className="flex-1" />

      <span className="path-text">{terminal.cwd}</span>

      <button
        onClick={onKill}
        className="p-1 rounded hover:bg-red-500/20 text-foreground-muted hover:text-red-400"
        title="Kill terminal"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
