import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface SidebarRevealProps {
  /** Docked mode: render children in normal flow, exactly as before. */
  pinned: boolean;
  children: ReactNode;
}

/** How long the overlay lingers after the pointer leaves, so brief exits
 *  (e.g. overshooting a button) don't flicker it closed. */
const CLOSE_DELAY_MS = 300;

/**
 * Renders the sidebar docked when pinned. When unpinned, the sidebar hides
 * entirely; a thin hot strip on the left edge slides it in as an overlay above
 * the canvas. The parent container must be `position: relative` — both the hot
 * strip and the overlay position against it.
 */
export function SidebarReveal({ pinned, children }: SidebarRevealProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };

  // Pinning while the overlay is open must not leave a stale timer or state.
  useEffect(() => {
    if (pinned) {
      cancelClose();
      setOpen(false);
    }
  }, [pinned]);

  useEffect(() => cancelClose, []);

  if (pinned) return <>{children}</>;

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <>
      {/* Hot strip. `buttons === 0` keeps it inert while any mouse button is
          held, so dragging a pane toward the left edge never pops the overlay. */}
      <div
        data-testid="sidebar-hot-strip"
        className="absolute left-0 top-0 bottom-0 w-1.5 z-40"
        onMouseEnter={(e) => {
          if (e.buttons === 0) {
            cancelClose();
            setOpen(true);
          }
        }}
      />
      <div
        data-testid="sidebar-flyout"
        className={`absolute left-0 top-0 bottom-0 z-50 shadow-2xl transition-transform duration-150 ${
          open ? "translate-x-0" : "-translate-x-full pointer-events-none"
        }`}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        {children}
      </div>
    </>
  );
}
