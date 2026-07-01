import { useRef, useEffect } from "react";
import { FolderInput } from "lucide-react";
import type { Workspace } from "../../types/terminal";

interface MoveToWorkspaceMenuProps {
  currentWorkspaceId: string;
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
  /** Controlled open state so a header right-click can open the same popover. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A small header control: a "move" button that toggles a popover listing every
 * workspace except the current one. Clicking a workspace moves the pane there.
 * Renders nothing when there is nowhere else to move to.
 */
export function MoveToWorkspaceMenu({
  currentWorkspaceId,
  workspaces,
  onMove,
  open,
  onOpenChange,
}: MoveToWorkspaceMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const targets = workspaces.filter((w) => w.id !== currentWorkspaceId);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  if (targets.length === 0) return null;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        title="Move to workspace"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100"
      >
        <FolderInput size={11} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 min-w-[10rem] rounded-md border border-card-border bg-background-secondary/95 backdrop-blur-xl shadow-lg py-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-foreground-muted/60">
            Move to
          </div>
          {targets.map((w) => (
            <button
              key={w.id}
              onClick={(e) => {
                e.stopPropagation();
                onMove(w.id);
                onOpenChange(false);
              }}
              className="w-full text-left px-2 py-1 text-xs text-foreground hover:bg-white/10 truncate"
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
