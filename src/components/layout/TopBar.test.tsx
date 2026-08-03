import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopBar } from "./TopBar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(async () => {}),
    minimize: vi.fn(async () => {}),
  }),
}));
vi.mock("../../lib/ipc", () => ({
  toggleMaximizeWindow: vi.fn(async () => false),
}));

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    workspaces: [
      { id: "w1", name: "Workspace 1" },
      { id: "w2", name: "Workspace 2" },
    ],
    activeId: "w1",
    counts: { w1: 2 },
    paneCounts: {},
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onNewWindow: vi.fn(),
    onCloseWindow: vi.fn(),
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  it("renders one tab per workspace with live counts", () => {
    renderTopBar();
    expect(screen.getByText("Workspace 1")).toBeInTheDocument();
    expect(screen.getByText("Workspace 2")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // w1's count badge
  });

  it("switches workspace on tab click", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByText("Workspace 2"));
    expect(props.onSwitch).toHaveBeenCalledWith("w2");
  });

  it("creates a workspace from the + button", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByTitle("New workspace"));
    expect(props.onCreate).toHaveBeenCalled();
  });

  it("opens a new window and closes this one from the right cluster", () => {
    const props = renderTopBar();
    fireEvent.click(screen.getByTitle(/new window/i));
    expect(props.onNewWindow).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Close window"));
    expect(props.onCloseWindow).toHaveBeenCalled();
  });
});
