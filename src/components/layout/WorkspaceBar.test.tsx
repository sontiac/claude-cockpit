import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceBar } from "./WorkspaceBar";
import type { Workspace } from "../../types/terminal";

const workspaces: Workspace[] = [
  { id: "w1", name: "One" },
  { id: "w2", name: "Two" },
  { id: "w3", name: "Three" },
];

function renderBar(overrides: Partial<Parameters<typeof WorkspaceBar>[0]> = {}) {
  const props = {
    workspaces,
    activeId: "w1",
    counts: {},
    paneCounts: {},
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onNewWindow: vi.fn(),
    ...overrides,
  };
  render(<WorkspaceBar {...props} />);
  return props;
}

describe("WorkspaceBar reordering", () => {
  // Requires dragDropEnabled=false in tauri.conf.json (and
  // disable_drag_drop_handler in open_window) — with Tauri's native handler
  // on, DOM drop events never fire on macOS.
  it("reorders workspaces when a tab is dragged onto another", () => {
    const { onReorder } = renderBar();
    const dt = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    fireEvent.dragStart(screen.getByText("One"), { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("text/plain", "w1");
    fireEvent.dragOver(screen.getByText("Three"), { dataTransfer: dt });
    fireEvent.drop(screen.getByText("Three"), { dataTransfer: dt });
    expect(onReorder).toHaveBeenCalledWith(["w2", "w3", "w1"]);
  });

  it("dropping a tab on itself does not reorder", () => {
    const { onReorder } = renderBar();
    const dt = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    fireEvent.dragStart(screen.getByText("Two"), { dataTransfer: dt });
    fireEvent.drop(screen.getByText("Two"), { dataTransfer: dt });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("a tab being renamed is not draggable", () => {
    renderBar();
    const tab = screen.getByText("Two").closest("[draggable]")!;
    expect(tab).toHaveAttribute("draggable", "true");
    fireEvent.doubleClick(screen.getByText("Two"));
    // The name is now an input; the tab root must opt out of dragging so text
    // selection inside the input can't start a tab drag.
    expect(screen.getByDisplayValue("Two").closest("[draggable]")).toHaveAttribute(
      "draggable",
      "false"
    );
  });
});

describe("WorkspaceBar basics", () => {
  it("switches workspace on click", () => {
    const { onSwitch } = renderBar();
    fireEvent.click(screen.getByText("Two"));
    expect(onSwitch).toHaveBeenCalledWith("w2");
  });

  it("commits a rename on Enter", () => {
    const { onRename } = renderBar();
    fireEvent.doubleClick(screen.getByText("Three"));
    const input = screen.getByDisplayValue("Three");
    fireEvent.change(input, { target: { value: "Focus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("w3", "Focus");
  });
});
