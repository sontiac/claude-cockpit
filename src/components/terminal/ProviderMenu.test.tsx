import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderMenu } from "./ProviderMenu";

const mockProviders = vi.hoisted(() => ({
  list: [
    { id: "claude", label: "Claude", contextWindow: 1048576, model: null },
    { id: "kimi", label: "Kimi", contextWindow: 1048576, model: "k3[1m]" },
  ],
}));

vi.mock("../../hooks/useProviders", () => ({
  useProviders: () => mockProviders.list,
}));

describe("ProviderMenu", () => {
  it("opens a menu listing providers and reports the picked id", () => {
    const onPick = vi.fn();
    render(<ProviderMenu onPick={onPick} />);

    fireEvent.click(screen.getByTitle("New terminal with provider…"));
    fireEvent.click(screen.getByText("Kimi"));

    expect(onPick).toHaveBeenCalledWith("kimi");
  });

  it("renders nothing when only one provider exists", () => {
    mockProviders.list = [
      { id: "claude", label: "Claude", contextWindow: 1048576, model: null },
    ];
    const { container } = render(<ProviderMenu onPick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
    mockProviders.list = [
      { id: "claude", label: "Claude", contextWindow: 1048576, model: null },
      { id: "kimi", label: "Kimi", contextWindow: 1048576, model: "k3[1m]" },
    ];
  });
});
