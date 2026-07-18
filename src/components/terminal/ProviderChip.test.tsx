import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProviderChip } from "./ProviderChip";

vi.mock("../../hooks/useProviders", () => ({
  useProviders: () => [
    { id: "claude", label: "Claude", contextWindow: 1048576 },
    { id: "kimi", label: "Kimi", contextWindow: 1048576 },
  ],
}));

describe("ProviderChip", () => {
  it("shows the provider label for a non-default provider", () => {
    render(<ProviderChip provider="kimi" />);
    expect(screen.getByText("Kimi")).toBeInTheDocument();
  });

  it("renders nothing for the default provider or none", () => {
    const { container: a } = render(<ProviderChip provider="claude" />);
    expect(a.innerHTML).toBe("");
    const { container: b } = render(<ProviderChip provider={null} />);
    expect(b.innerHTML).toBe("");
  });

  it("falls back to the raw id when the provider list lacks it", () => {
    render(<ProviderChip provider="glm" />);
    expect(screen.getByText("glm")).toBeInTheDocument();
  });
});
