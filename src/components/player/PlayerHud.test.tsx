import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlayerHud } from "./PlayerHud";
import { derivePlayer } from "../../lib/player";

vi.mock("../../hooks/usePlayer", () => ({
  usePlayer: vi.fn(),
}));

import { usePlayer } from "../../hooks/usePlayer";

const mockedUsePlayer = vi.mocked(usePlayer);

const player = derivePlayer({
  outputTokens: 500_000_000,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  userMessages: 1000,
  assistantMessages: 1500,
  toolCalls: 2000,
  sessions: 50,
  projects: 4,
});

describe("PlayerHud", () => {
  it("opens the character card when the HUD button is clicked", () => {
    mockedUsePlayer.mockReturnValue({ player, levelUp: null });
    render(<PlayerHud />);

    expect(screen.queryByText("Character")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Character")).toBeInTheDocument();
  });

  it("hides the level-up burst once the character card is opened by clicking it", () => {
    mockedUsePlayer.mockReturnValue({
      player,
      levelUp: { level: 225, milestone: false },
    });
    render(<PlayerHud />);

    expect(screen.getByText("LEVEL 225")).toBeInTheDocument();
    fireEvent.click(screen.getByText("LEVEL 225"));

    // The card is now open and should stay visible...
    expect(screen.getByText("Character")).toBeInTheDocument();
    // ...while the burst that opened it must no longer be painting on top.
    expect(screen.queryByText("LEVEL 225")).toBeNull();
  });
});
