import { describe, it, expect, vi } from "vitest";
import { scrollSafeFit, type ScrollableTerm, type Fitter } from "./xtermScroll";

function makeTerm(viewportY: number, baseY: number): ScrollableTerm {
  return {
    buffer: { active: { viewportY, baseY } },
    scrollToBottom: vi.fn(),
    scrollToLine: vi.fn(),
  };
}

describe("scrollSafeFit", () => {
  it("snaps to the bottom after fitting when the viewport was at the bottom", () => {
    const term = makeTerm(50, 50); // viewportY === baseY → at bottom
    const fit: Fitter = { fit: vi.fn() };
    scrollSafeFit(term, fit);
    expect(fit.fit).toHaveBeenCalledOnce();
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
    expect(term.scrollToLine).not.toHaveBeenCalled();
  });

  it("restores the scrolled-up line through the terminal API, not the DOM", () => {
    const term = makeTerm(10, 50); // scrolled up into history
    const fit: Fitter = { fit: vi.fn() };
    scrollSafeFit(term, fit);
    expect(term.scrollToBottom).not.toHaveBeenCalled();
    expect(term.scrollToLine).toHaveBeenCalledWith(10);
  });

  it("reads the scroll position before fitting, not after", () => {
    // fit() reflows the buffer, which moves viewportY. The position we restore
    // has to be the one the user was looking at *before* the resize.
    const term = makeTerm(10, 50);
    const fit: Fitter = {
      fit: vi.fn(() => {
        term.buffer.active.viewportY = 0;
      }),
    };
    scrollSafeFit(term, fit);
    expect(term.scrollToLine).toHaveBeenCalledWith(10);
  });

  it("fits before restoring, so the restore lands on the new geometry", () => {
    const term = makeTerm(50, 50);
    const order: string[] = [];
    const fit: Fitter = { fit: vi.fn(() => order.push("fit")) };
    term.scrollToBottom = vi.fn(() => order.push("scroll"));
    scrollSafeFit(term, fit);
    expect(order).toEqual(["fit", "scroll"]);
  });
});
