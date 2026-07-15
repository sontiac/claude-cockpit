import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveToWorkspaceMenu } from "./MoveToWorkspaceMenu";
import type { Workspace } from "../../types/terminal";

const workspaces: Workspace[] = [
  { id: "ws1", name: "Workspace 1" },
  { id: "ws2", name: "Workspace 2" },
];

function renderMenu(open = true, onMove = vi.fn(), onOpenChange = vi.fn()) {
  const utils = render(
    <div data-testid="pane-header">
      <MoveToWorkspaceMenu
        currentWorkspaceId="ws1"
        workspaces={workspaces}
        onMove={onMove}
        open={open}
        onOpenChange={onOpenChange}
      />
    </div>
  );
  return { ...utils, onMove, onOpenChange };
}

describe("MoveToWorkspaceMenu", () => {
  it("renders the open popover as a direct child of document.body (portal)", () => {
    renderMenu();
    const header = screen.getByTestId("pane-header");
    const item = screen.getByText("Workspace 2");
    // Portaled: the popover must have escaped the header subtree entirely
    // and live under document.body instead.
    expect(header).not.toContainElement(item);
    expect(document.body).toContainElement(item);
    // And the popover's root must be a *direct* child of body.
    let node: HTMLElement | null = item;
    while (node && node.parentElement !== document.body) {
      node = node.parentElement;
    }
    expect(node).not.toBeNull();
    expect(node!.parentElement).toBe(document.body);
  });

  it("moves to the clicked workspace and closes", () => {
    const { onMove, onOpenChange } = renderMenu();
    fireEvent.click(screen.getByText("Workspace 2"));
    expect(onMove).toHaveBeenCalledWith("ws2");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on an outside mousedown", () => {
    const { onOpenChange } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing when there is nowhere to move to", () => {
    const { container } = render(
      <MoveToWorkspaceMenu
        currentWorkspaceId="ws1"
        workspaces={[workspaces[0]]}
        onMove={vi.fn()}
        open={false}
        onOpenChange={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
