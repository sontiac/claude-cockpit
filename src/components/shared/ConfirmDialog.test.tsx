import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConfirmSpec } from "../../types/confirm";

const spec: ConfirmSpec = {
  title: "Close this window?",
  body: "This will permanently close 2 terminals in it.",
  confirmLabel: "Close window",
};

describe("ConfirmDialog", () => {
  it("renders nothing without a spec", () => {
    render(<ConfirmDialog spec={null} onRespond={vi.fn()} />);
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });

  it("shows the title, body, and confirm label", () => {
    render(<ConfirmDialog spec={spec} onRespond={vi.fn()} />);
    expect(screen.getByText("Close this window?")).toBeInTheDocument();
    expect(
      screen.getByText("This will permanently close 2 terminals in it.")
    ).toBeInTheDocument();
    expect(screen.getByText("Close window")).toBeInTheDocument();
  });

  it("portals to document.body so ancestor styles cannot trap it", () => {
    const { container } = render(
      <ConfirmDialog spec={spec} onRespond={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByText(spec.title).closest("body")).toBe(document.body);
  });

  it("responds true on the confirm button", () => {
    const onRespond = vi.fn();
    render(<ConfirmDialog spec={spec} onRespond={onRespond} />);
    fireEvent.click(screen.getByText("Close window"));
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it("responds false on Cancel", () => {
    const onRespond = vi.fn();
    render(<ConfirmDialog spec={spec} onRespond={onRespond} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onRespond).toHaveBeenCalledWith(false);
  });

  it("responds false on backdrop click but not on card click", () => {
    const onRespond = vi.fn();
    render(<ConfirmDialog spec={spec} onRespond={onRespond} />);
    fireEvent.click(screen.getByText(spec.body));
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(spec.title).closest(".fixed")!);
    expect(onRespond).toHaveBeenCalledWith(false);
  });
});
