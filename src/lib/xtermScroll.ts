/** The slice of xterm's Terminal that scroll-safe fitting needs. */
export interface ScrollableTerm {
  buffer: { active: { viewportY: number; baseY: number } };
  scrollToBottom(): void;
  scrollToLine(line: number): void;
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
 * bottom — otherwise a pane/window resize leaves the newest lines (e.g. a
 * question Claude just painted) hidden. When the user has scrolled up into
 * history, the line they were parked on is restored instead.
 *
 * Both moves go through the terminal's own scroll API. Reaching into the DOM
 * would not work: as of xterm 6 the scroller is a VS Code
 * `SmoothScrollableElement` (`.xterm-scrollable-element`) that owns the scroll
 * offset itself, and the `.xterm-viewport` div that used to scroll natively is
 * now an empty leftover whose `scrollTop` is always 0.
 */
export function scrollSafeFit(term: ScrollableTerm, fitAddon: Fitter): void {
  // Read before fitting: fit() reflows the buffer and moves viewportY.
  const { viewportY, baseY } = term.buffer.active;
  const atBottom = viewportY >= baseY;

  fitAddon.fit();

  if (atBottom) {
    term.scrollToBottom();
  } else {
    term.scrollToLine(viewportY);
  }
}
