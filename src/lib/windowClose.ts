import type { ConfirmSpec } from "../types/confirm";

/** "2 terminals and 1 pane" — null when both counts are zero. */
function liveContentLabel(
  terminalCount: number,
  paneCount: number
): string | null {
  const parts: string[] = [];
  if (terminalCount > 0) {
    parts.push(`${terminalCount} terminal${terminalCount === 1 ? "" : "s"}`);
  }
  if (paneCount > 0) {
    parts.push(`${paneCount} pane${paneCount === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" and ") : null;
}

/**
 * Confirmation for closing one window of several. Closing forgets the window
 * for good — its terminals are killed and its panes deleted, with no recovery
 * offered. Returns null when the window is empty: nothing to lose, close
 * without a prompt.
 */
export function closeWindowConfirm(
  terminalCount: number,
  paneCount: number
): ConfirmSpec | null {
  const label = liveContentLabel(terminalCount, paneCount);
  if (!label) return null;
  return {
    title: "Close this window?",
    body: `This will permanently close ${label} in it.`,
    confirmLabel: "Close window",
  };
}

/**
 * Confirmation for quitting the whole app from the last window's ✕. Quitting
 * kills the running terminals but keeps the session on disk, so the next
 * launch offers recovery — the body says so. Returns null when nothing is
 * running.
 */
export function quitAppConfirm(
  terminalCount: number,
  paneCount: number
): ConfirmSpec | null {
  const label = liveContentLabel(terminalCount, paneCount);
  if (!label) return null;
  return {
    title: "Quit Claude Cockpit?",
    body: `Quitting will close ${label}. You can restore this session the next time Cockpit launches.`,
    confirmLabel: "Quit",
  };
}
