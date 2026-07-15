import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { PomodoroCell } from "./PomodoroCell";
import type { PomodoroPane } from "../../types/pane";

vi.mock("../../hooks/useSounds", () => ({
  useSounds: () => ({ play: vi.fn() }),
}));
vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => ({ notify: vi.fn().mockResolvedValue(undefined) }),
}));

type ROCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;
let lastCallback: ROCallback | null = null;

class MockResizeObserver {
  constructor(cb: ROCallback) {
    lastCallback = cb;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  lastCallback = null;
});
afterEach(() => vi.unstubAllGlobals());

const pane: PomodoroPane = {
  id: "p1",
  label: "Pomodoro",
  color: "#06b6d4",
  workspaceId: "ws1",
  kind: "pomodoro",
  workMinutes: 25,
  breakMinutes: 5,
};

function renderCell() {
  return render(
    <PomodoroCell
      pane={pane}
      isActive={false}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onRename={vi.fn()}
      onSetDurations={vi.fn()}
      workspaces={[{ id: "ws1", name: "Workspace 1" }]}
      onMove={vi.fn()}
    />
  );
}

function resizeTo(width: number, height: number) {
  act(() => {
    lastCallback!([{ contentRect: { width, height } }]);
  });
}

describe("PomodoroCell responsive layout", () => {
  it("renders the ring layout at comfortable sizes", () => {
    const { container } = renderCell();
    resizeTo(400, 400);
    // Scoped to `.pomodoro-ring`: a bare "svg circle" query also matches the
    // header's Timer icon (lucide's clock face is itself a <circle>), which
    // is present in both layouts and so can't distinguish them.
    expect(container.querySelector(".pomodoro-ring svg circle")).not.toBeNull();
    expect(screen.getByText("25:00")).toBeInTheDocument();
    expect(screen.getByLabelText(/focus/i)).toBeInTheDocument(); // duration input
  });

  it("renders the ring layout before the first measurement (0x0 = unknown)", () => {
    const { container } = renderCell();
    expect(container.querySelector(".pomodoro-ring svg circle")).not.toBeNull();
  });

  it("switches to the compact bar layout when the pane is small", () => {
    const { container } = renderCell();
    resizeTo(200, 150);
    expect(container.querySelector(".pomodoro-ring svg circle")).toBeNull();
    expect(screen.getByText("25:00")).toBeInTheDocument();
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(container.querySelector(".pomodoro-bar")).not.toBeNull();
    // No duration editors in compact mode.
    expect(screen.queryByLabelText(/focus/i)).toBeNull();
    // Controls still there (icon-only).
    expect(screen.getByTitle("Start")).toBeInTheDocument();
    expect(screen.getByTitle("Reset")).toBeInTheDocument();
  });
});
