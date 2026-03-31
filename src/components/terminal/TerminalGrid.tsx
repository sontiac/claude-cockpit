import { useState } from "react";
import { Plus, Grid2x2, Square, Columns2, LayoutGrid } from "lucide-react";
import { TerminalCell } from "./TerminalCell";
import type { TerminalInfo, TerminalStatus } from "../../types/terminal";

type GridLayout = "single" | "cols-2" | "grid-2x2" | "grid-3x2";

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

const layoutConfig: Record<GridLayout, { cols: number; label: string }> = {
  single: { cols: 1, label: "Single" },
  "cols-2": { cols: 2, label: "2 Columns" },
  "grid-2x2": { cols: 2, label: "2x2 Grid" },
  "grid-3x2": { cols: 3, label: "3x2 Grid" },
};

const layoutIcons: Record<GridLayout, typeof Square> = {
  single: Square,
  "cols-2": Columns2,
  "grid-2x2": Grid2x2,
  "grid-3x2": LayoutGrid,
};

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
  const [layout, setLayout] = useState<GridLayout>("single");

  // Auto-pick layout based on terminal count if user hasn't explicitly chosen
  const effectiveLayout = layout;
  const { cols } = layoutConfig[effectiveLayout];

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
      {/* Toolbar with layout selector */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-background-secondary/30 border-b border-card-border">
        <div className="flex items-center gap-1">
          <span className="text-xs text-foreground-muted mr-2">
            {terminals.length} terminal{terminals.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Layout buttons */}
          {(Object.keys(layoutConfig) as GridLayout[]).map((l) => {
            const Icon = layoutIcons[l];
            return (
              <button
                key={l}
                onClick={() => setLayout(l)}
                className={`p-1.5 rounded-md transition-colors ${
                  layout === l
                    ? "bg-white/10 text-foreground"
                    : "text-foreground-muted hover:text-foreground hover:bg-white/5"
                }`}
                title={layoutConfig[l].label}
              >
                <Icon size={14} />
              </button>
            );
          })}

          <div className="w-px h-4 bg-card-border mx-1" />

          <button
            onClick={onNewTerminal}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
            title="New terminal (Cmd+T)"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Terminal grid */}
      <div
        className="flex-1 min-h-0 grid gap-px bg-card-border/50"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows:
            effectiveLayout === "single" ? "1fr" : "minmax(0, 1fr)",
        }}
      >
        {terminals.map((terminal) => (
          <TerminalCell
            key={terminal.id}
            terminal={terminal}
            isActive={terminal.id === activeId}
            onSelect={() => onSelect(terminal.id)}
            onClose={() => onClose(terminal.id)}
            onRename={(label) => onRename(terminal.id, label)}
            onStatusChange={(status) => onStatusChange(terminal.id, status)}
            onExit={(code) => onExit(terminal.id, code)}
          />
        ))}
      </div>
    </div>
  );
}
