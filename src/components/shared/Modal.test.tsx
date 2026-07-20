import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Hidden">
        <p>content</p>
      </Modal>
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("portals to document.body so ancestor styles cannot trap it", () => {
    // A backdrop-filter (e.g. the status bar's backdrop-blur) turns an
    // ancestor into the containing block for fixed descendants — the modal
    // must escape via a portal to truly cover the viewport.
    const { container } = render(
      <Modal open onClose={vi.fn()} title="Character">
        <p>content</p>
      </Modal>
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByText("Character").closest("body")).toBe(document.body);
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Character">
        <p>content</p>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on card click", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Character">
        <p>content</p>
      </Modal>
    );
    fireEvent.click(screen.getByText("content"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Character").closest(".fixed")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
