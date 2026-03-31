import { Plus } from "lucide-react";
import { TerminalTab } from "./TerminalTab";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalToolbar } from "./TerminalToolbar";
import type { TerminalInfo, TerminalStatus } from "../../types/terminal";

interface TerminalGridProps {
  terminals: TerminalInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onStatusChange: (id: string, status: TerminalStatus) => void;
  onExit: (id: string, code: number | null) => void;
  onNewTerminal: () => void;
}

export function TerminalGrid({
  terminals,
  activeId,
  onSelect,
  onClose,
  onRename,
  onStatusChange,
  onExit,
  onNewTerminal,
}: TerminalGridProps) {
  const activeTerminal = terminals.find((t) => t.id === activeId);

  if (terminals.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-foreground-muted text-lg">No terminals open</p>
          <button
            onClick={onNewTerminal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30 font-medium text-sm"
          >
            <Plus size={16} />
            New Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center bg-background-secondary/30 border-b border-card-border overflow-x-auto">
        {terminals.map((terminal) => (
          <TerminalTab
            key={terminal.id}
            terminal={terminal}
            active={terminal.id === activeId}
            onSelect={() => onSelect(terminal.id)}
            onClose={() => onClose(terminal.id)}
          />
        ))}
        <button
          onClick={onNewTerminal}
          className="p-2 text-foreground-muted hover:text-foreground hover:bg-white/5"
          title="New terminal"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Active terminal toolbar */}
      {activeTerminal && (
        <TerminalToolbar
          terminal={activeTerminal}
          onRename={(label) => onRename(activeTerminal.id, label)}
          onKill={() => onClose(activeTerminal.id)}
        />
      )}

      {/* Terminal panels (all mounted, only active visible) */}
      <div className="flex-1 min-h-0 relative">
        {terminals.map((terminal) => (
          <TerminalPanel
            key={terminal.id}
            id={terminal.id}
            active={terminal.id === activeId}
            onStatusChange={(status) => onStatusChange(terminal.id, status)}
            onExit={(code) => onExit(terminal.id, code)}
          />
        ))}
      </div>
    </div>
  );
}
