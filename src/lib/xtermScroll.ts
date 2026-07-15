/** The slice of xterm's Terminal that scroll-safe fitting needs. */
export interface ScrollableTerm {
  buffer: { active: { viewportY: number; baseY: number } };
  scrollToBottom(): void;
}

/** The slice of FitAddon that scroll-safe fitting needs. */
export interface Fitter {
  fit(): void;
}

/**
 * Calls fitAddon.fit() without losing the user's place in the terminal.
 *
 * When the viewport is at the live bottom (viewportY has caught up to baseY),
 * the user is following output, so the refit must land back at the *new*
 * bottom — restoring the old absolute scrollTop here is what used to leave
 * the newest lines (e.g. a question Claude just painted) hidden after a
 * pane/window resize. When the user has scrolled up into history, the
 * absolute position is preserved instead.
 */
export function scrollSafeFit(
  term: ScrollableTerm,
  fitAddon: Fitter,
  container: HTMLElement
): void {
  const { viewportY, baseY } = term.buffer.active;
  const atBottom = viewportY >= baseY;

  const viewport = container.querySelector(
    ".xterm-viewport"
  ) as HTMLElement | null;
  if (!viewport) {
    fitAddon.fit();
    if (atBottom) term.scrollToBottom();
    return;
  }

  const scrollTop = viewport.scrollTop;
  // Lock scroll during fit so the browser can't adjust scrollTop mid-resize.
  viewport.style.overflowY = "hidden";
  fitAddon.fit();
  if (atBottom) {
    term.scrollToBottom();
  } else {
    viewport.scrollTop = scrollTop;
  }
  viewport.style.overflowY = "";
}
