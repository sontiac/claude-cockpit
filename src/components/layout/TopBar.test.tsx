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

describe("TopBar reordering", () => {
  const threeWorkspaces = [
    { id: "w1", name: "One" },
    { id: "w2", name: "Two" },
    { id: "w3", name: "Three" },
  ];

  // Requires dragDropEnabled=false in tauri.conf.json (and
  // disable_drag_drop_handler in open_window) — with Tauri's native handler
  // on, DOM drop events never fire on macOS.
  it("reorders workspaces when a tab is dragged onto another", () => {
    const props = renderTopBar({ workspaces: threeWorkspaces, counts: {} });
    const dt = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    fireEvent.dragStart(screen.getByText("One"), { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("text/plain", "w1");
    fireEvent.dragOver(screen.getByText("Three"), { dataTransfer: dt });
    fireEvent.drop(screen.getByText("Three"), { dataTransfer: dt });
    expect(props.onReorder).toHaveBeenCalledWith(["w2", "w3", "w1"]);
  });

  it("dropping a tab on itself does not reorder", () => {
    const props = renderTopBar({ workspaces: threeWorkspaces, counts: {} });
    const dt = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    fireEvent.dragStart(screen.getByText("Two"), { dataTransfer: dt });
    fireEvent.drop(screen.getByText("Two"), { dataTransfer: dt });
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("a tab being renamed is not draggable", () => {
    renderTopBar();
    const tab = screen.getByText("Workspace 2").closest("[draggable]")!;
    expect(tab).toHaveAttribute("draggable", "true");
    fireEvent.doubleClick(screen.getByText("Workspace 2"));
    // The name is now an input; the tab root must opt out of dragging so text
    // selection inside the input can't start a tab drag.
    expect(
      screen.getByDisplayValue("Workspace 2").closest("[draggable]")
    ).toHaveAttribute("draggable", "false");
  });
});

describe("TopBar renaming", () => {
  it("commits a rename on Enter", () => {
    const props = renderTopBar();
    fireEvent.doubleClick(screen.getByText("Workspace 2"));
    const input = screen.getByDisplayValue("Workspace 2");
    fireEvent.change(input, { target: { value: "Focus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).toHaveBeenCalledWith("w2", "Focus");
  });

  it("discards the edit on Escape without renaming", () => {
    const props = renderTopBar();
    fireEvent.doubleClick(screen.getByText("Workspace 2"));
    const input = screen.getByDisplayValue("Workspace 2");
    fireEvent.change(input, { target: { value: "Focus" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Focus")).not.toBeInTheDocument();
    expect(screen.getByText("Workspace 2")).toBeInTheDocument();
  });
});
