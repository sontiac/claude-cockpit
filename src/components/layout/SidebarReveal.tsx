import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

interface SidebarRevealProps {
  /** Docked mode: render children in normal flow, exactly as before. */
  pinned: boolean;
  children: ReactNode;
}

/** How long the overlay lingers after the pointer leaves, so brief exits
 *  (e.g. overshooting a button) don't flicker it closed. */
const CLOSE_DELAY_MS = 300;

interface SidebarRevealHold {
  /** Increment the hold count; call once per reason the flyout must stay open. */
  hold: () => void;
  /** Decrement the hold count; must be paired 1:1 with a prior hold(). */
  release: () => void;
}

const noopHold: SidebarRevealHold = { hold: () => {}, release: () => {} };

/**
 * Lets something rendered inside the sidebar but portaled to document.body — the
 * right-click context menu, a ProviderMenu popover — keep the unpinned flyout
 * open for as long as it's up. A portaled element isn't a DOM descendant of the
 * flyout, so the pointer moving onto it still fires the flyout's mouseLeave,
 * which would otherwise close the sidebar underneath its own open popover.
 * Ref-counted because more than one such popover can be open at once. Defaults
 * to a no-op so consumers rendered outside a SidebarReveal (e.g. ProviderMenu in
 * the terminal toolbar) are unaffected.
 */
const SidebarRevealHoldContext = createContext<SidebarRevealHold>(noopHold);

export function useSidebarRevealHold(): SidebarRevealHold {
  return useContext(SidebarRevealHoldContext);
}

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
  const holdCount = useRef(0);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      // A held popover is portaled outside the flyout's DOM subtree, so the
      // pointer moving onto it already fired this close via mouseLeave. Skip
      // it here; release() re-schedules once the last hold is gone.
      if (holdCount.current === 0) setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  const hold = useCallback(() => {
    holdCount.current += 1;
  }, []);
  const release = useCallback(() => {
    holdCount.current = Math.max(0, holdCount.current - 1);
    if (holdCount.current === 0) scheduleClose();
  }, [scheduleClose]);
  const holdContextValue = useMemo(() => ({ hold, release }), [hold, release]);

  // Pinning while the overlay is open must not leave a stale timer, state, or
  // hold count.
  useEffect(() => {
    if (pinned) {
      cancelClose();
      setOpen(false);
      holdCount.current = 0;
    }
  }, [pinned, cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  if (pinned) {
    // No close behavior to hold open in docked mode.
    return (
      <SidebarRevealHoldContext.Provider value={noopHold}>
        {children}
      </SidebarRevealHoldContext.Provider>
    );
  }

  return (
    <SidebarRevealHoldContext.Provider value={holdContextValue}>
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
    </SidebarRevealHoldContext.Provider>
  );
}
