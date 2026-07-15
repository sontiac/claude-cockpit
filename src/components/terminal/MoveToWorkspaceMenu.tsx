import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * The popover is portaled to document.body with fixed positioning. Inside the
 * pane it would be unusable: the header's backdrop-filter creates a
 * zero-z-index stacking context that xterm's positioned opaque layers paint
 * over, and the pane's overflow-hidden would clip it in short panes.
 */
export function MoveToWorkspaceMenu({
  currentWorkspaceId,
  workspaces,
  onMove,
  open,
  onOpenChange,
}: MoveToWorkspaceMenuProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const targets = workspaces.filter((w) => w.id !== currentWorkspaceId);

  // Anchor the fixed-position popover to the trigger button when opening.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [open]);

  // A fixed-position menu must not drift from its anchor: close on any
  // scroll/resize as well as outside clicks and Escape.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) {
        return;
      }
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const close = () => onOpenChange(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open, onOpenChange]);

  if (targets.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        title="Move to workspace"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className="p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground opacity-0 group-hover:opacity-100 flex-shrink-0"
      >
        <FolderInput size={11} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[10rem] rounded-md border border-card-border bg-background-secondary/95 backdrop-blur-xl shadow-lg py-1"
            style={{ top: pos.top, right: pos.right }}
          >
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
          </div>,
          document.body
        )}
    </>
  );
}
