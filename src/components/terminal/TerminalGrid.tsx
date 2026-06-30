import { useMemo, useRef, useCallback } from "react";
import { Plus, LayoutGrid } from "lucide-react";
import { TerminalCanvas } from "./TerminalCanvas";
import { useCanvasLayout, tileRects } from "../../hooks/useCanvasLayout";
import type { TerminalInfo, TerminalStatus } from "../../types/terminal";

interface TerminalGridProps {
  terminals: TerminalInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onSessionRename: (id: string, sessionName: string) => void;
  onStatusChange: (id: string, status: TerminalStatus) => void;
  onExit: (id: string, code: number | null) => void;
  onNewTerminal: () => void;
}

/**
 * The terminal workspace: a single free-form canvas of draggable, resizable
 * terminal windows. There is no separate "tiled" view — the old presets are now
 * one-shot *arrange* actions that tidy the windows into a grid (1/2/3 columns or
 * auto), after which each window can still be freely moved and resized.
 */
export function TerminalGrid({
  terminals,
  activeId,
  onSelect,
  onClose,
  onRename,
  onSessionRename,
  onStatusChange,
  onExit,
  onNewTerminal,
}: TerminalGridProps) {
  const ids = useMemo(() => terminals.map((t) => t.id), [terminals]);
  const { layout, setRect, setAll } = useCanvasLayout(ids);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Tile every window into `cols` columns (0 = auto) filling the visible canvas
  // area. Windows remain freely draggable/resizable after arranging.
  const arrange = useCallback(
    (cols: number) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const w = surface.clientWidth;
      const h = surface.clientHeight;
      if (w === 0 || h === 0) return;
      setAll(tileRects(ids, cols, w, h));
    },
    [ids, setAll]
  );

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

  const colButtonClass =
    "w-7 h-7 rounded-md text-xs font-semibold text-foreground-muted hover:text-foreground hover:bg-white/5 transition-colors";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar: window count + arrange presets. */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-background-secondary/20 backdrop-blur-xl border-b border-white/10">
        <span className="text-xs text-foreground-muted">
          {terminals.length} terminal{terminals.length !== 1 ? "s" : ""}
        </span>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-foreground-muted/60 mr-1">
            Arrange
          </span>
          <button
            onClick={() => arrange(0)}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5 transition-colors"
            title="Tidy up (auto grid)"
          >
            <LayoutGrid size={14} />
          </button>
          {[1, 2, 3].map((cols) => (
            <button
              key={cols}
              onClick={() => arrange(cols)}
              className={colButtonClass}
              title={`Arrange in ${cols} column${cols > 1 ? "s" : ""}`}
            >
              {cols}
            </button>
          ))}

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

      <TerminalCanvas
        terminals={terminals}
        activeId={activeId}
        layout={layout}
        setRect={setRect}
        surfaceRef={surfaceRef}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onSessionRename={onSessionRename}
        onStatusChange={onStatusChange}
        onExit={onExit}
      />
    </div>
  );
}
