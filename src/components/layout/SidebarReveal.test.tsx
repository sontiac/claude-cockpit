import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SidebarReveal } from "./SidebarReveal";

describe("SidebarReveal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders children directly when pinned (no hot strip, no flyout)", () => {
    render(
      <SidebarReveal pinned>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    expect(screen.getByText("sidebar content")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-hot-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-flyout")).not.toBeInTheDocument();
  });

  it("starts hidden when unpinned and opens on hot-strip hover", () => {
    render(
      <SidebarReveal pinned={false}>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    const flyout = screen.getByTestId("sidebar-flyout");
    expect(flyout.className).toContain("-translate-x-full");

    fireEvent.mouseEnter(screen.getByTestId("sidebar-hot-strip"), { buttons: 0 });
    expect(flyout.className).toContain("translate-x-0");
  });

  it("does not open while a mouse button is held (pane drag in progress)", () => {
    render(
      <SidebarReveal pinned={false}>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    fireEvent.mouseEnter(screen.getByTestId("sidebar-hot-strip"), { buttons: 1 });
    expect(screen.getByTestId("sidebar-flyout").className).toContain(
      "-translate-x-full"
    );
  });

  it("closes after the delay on mouse leave, and re-enter cancels the close", () => {
    render(
      <SidebarReveal pinned={false}>
        <div>sidebar content</div>
      </SidebarReveal>
    );
    const strip = screen.getByTestId("sidebar-hot-strip");
    const flyout = screen.getByTestId("sidebar-flyout");

    fireEvent.mouseEnter(strip, { buttons: 0 });
    fireEvent.mouseLeave(flyout);
    // Still open before the delay elapses.
    act(() => vi.advanceTimersByTime(200));
    expect(flyout.className).toContain("translate-x-0");

    // Re-enter cancels the pending close.
    fireEvent.mouseEnter(flyout);
    act(() => vi.advanceTimersByTime(500));
    expect(flyout.className).toContain("translate-x-0");

    // Leave again and let the delay elapse: closed.
    fireEvent.mouseLeave(flyout);
    act(() => vi.advanceTimersByTime(500));
    expect(flyout.className).toContain("-translate-x-full");
  });
});
