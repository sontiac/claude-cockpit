import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextPill } from "./ContextPill";

describe("ContextPill", () => {
  it("shows tokens only when model/effort are absent", () => {
    const { container } = render(<ContextPill tokens={74_000} />);
    expect(screen.getByText("74k")).toBeInTheDocument();
    expect(container.querySelector(".pill-model")).toBeNull();
    expect(container.querySelector(".pill-effort")).toBeNull();
  });

  it("shows model and effort with discard-priority classes", () => {
    const { container } = render(
      <ContextPill tokens={74_000} model="claude-fable-5" effort="high" />
    );
    expect(screen.getByText("Fable 5")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(container.querySelector(".pill-model")).not.toBeNull();
    expect(container.querySelector(".pill-effort")).not.toBeNull();
  });
});
