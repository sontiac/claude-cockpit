import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CharacterCard } from "./CharacterCard";
import { derivePlayer, nextMilestone } from "../../lib/player";

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

describe("CharacterCard", () => {
  it("shows level, class, XP and lifetime stats", () => {
    render(<CharacterCard player={player} open onClose={vi.fn()} />);
    expect(screen.getByText(`Level ${player.level}`)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(player.characterClass.name))
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`Level ${nextMilestone(player.level)}`))
    ).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByAltText(player.characterClass.name)).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <CharacterCard player={player} open={false} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
