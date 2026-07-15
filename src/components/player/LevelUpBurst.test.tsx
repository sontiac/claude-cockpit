import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LevelUpBurst } from "./LevelUpBurst";
import { derivePlayer } from "../../lib/player";

const player = derivePlayer({
  outputTokens: 500_000_000,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  userMessages: 100,
  assistantMessages: 100,
  toolCalls: 100,
  sessions: 10,
  projects: 2,
});

describe("LevelUpBurst", () => {
  it("portals a centered card with level and class to document.body", () => {
    render(
      <LevelUpBurst
        player={player}
        levelUp={{ level: 225, milestone: false }}
        onClick={vi.fn()}
      />
    );
    const card = screen.getByText("LEVEL 225");
    expect(document.body.contains(card)).toBe(true);
    expect(screen.getByText(new RegExp(player.characterClass.name))).toBeInTheDocument();
    expect(screen.queryByText(/MILESTONE/)).toBeNull();
  });

  it("shows the milestone treatment for milestone levels", () => {
    render(
      <LevelUpBurst
        player={player}
        levelUp={{ level: 225, milestone: true }}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByText(/MILESTONE/)).toBeInTheDocument();
  });

  it("fires onClick when the card is clicked", () => {
    const onClick = vi.fn();
    render(
      <LevelUpBurst
        player={player}
        levelUp={{ level: 225, milestone: false }}
        onClick={onClick}
      />
    );
    fireEvent.click(screen.getByText("LEVEL 225"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
