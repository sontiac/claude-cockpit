import { describe, it, expect, vi } from "vitest";
import { scrollSafeFit, type ScrollableTerm, type Fitter } from "./xtermScroll";

function makeTerm(viewportY: number, baseY: number): ScrollableTerm {
  return {
    buffer: { active: { viewportY, baseY } },
    scrollToBottom: vi.fn(),
  };
}

function makeContainer(withViewport = true): HTMLElement {
  const container = document.createElement("div");
  if (withViewport) {
    const viewport = document.createElement("div");
    viewport.className = "xterm-viewport";
    viewport.scrollTop = 120;
    container.appendChild(viewport);
  }
  return container;
}

describe("scrollSafeFit", () => {
  it("snaps to the bottom after fitting when the viewport was at the bottom", () => {
    const term = makeTerm(50, 50); // viewportY === baseY → at bottom
    const fit: Fitter = { fit: vi.fn() };
    scrollSafeFit(term, fit, makeContainer());
    expect(fit.fit).toHaveBeenCalledOnce();
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
  });

  it("preserves the absolute scroll position when scrolled up into history", () => {
    const term = makeTerm(10, 50); // scrolled up
    const fit: Fitter = { fit: vi.fn() };
    const container = makeContainer();
    const viewport = container.querySelector(".xterm-viewport") as HTMLElement;
    scrollSafeFit(term, fit, container);
    expect(term.scrollToBottom).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(120);
    expect(viewport.style.overflowY).toBe("");
  });

  it("still fits (and follows the bottom) when the viewport element is missing", () => {
    const term = makeTerm(50, 50);
    const fit: Fitter = { fit: vi.fn() };
    scrollSafeFit(term, fit, makeContainer(false));
    expect(fit.fit).toHaveBeenCalledOnce();
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
  });
});
