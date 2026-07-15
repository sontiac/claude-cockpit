import { createPortal } from "react-dom";
import type { LevelUp } from "../../hooks/usePlayer";
import type { Player } from "../../lib/player";
import { artForPlayer } from "../../lib/playerArt";

interface LevelUpBurstProps {
  player: Player;
  levelUp: LevelUp;
  /** Opens the character card (the burst doubles as a shortcut to it). */
  onClick: () => void;
}

/**
 * Center-screen level-up celebration. Rendered while usePlayer's `levelUp` is
 * set (3s ordinary / 5s milestone) — mounting/unmounting is the parent's job.
 * The backdrop passes pointer events through; only the card itself is
 * clickable.
 */
export function LevelUpBurst({ player, levelUp, onClick }: LevelUpBurstProps) {
  const milestone = levelUp.milestone;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
      <button
        onClick={onClick}
        className={`pointer-events-auto levelup-burst flex flex-col items-center gap-3 px-10 py-8 rounded-2xl border backdrop-blur-xl ${
          milestone
            ? "levelup-milestone border-accent-amber/60 bg-background-secondary/90"
            : "border-accent-cyan/40 bg-background-secondary/90"
        }`}
      >
        <img
          src={artForPlayer(player.characterClass.key, levelUp.level)}
          alt={player.characterClass.name}
          className={`rounded-xl object-cover ${milestone ? "w-44 h-44" : "w-32 h-32"}`}
        />
        {milestone && (
          <div className="text-xs font-bold tracking-[0.3em] text-accent-amber">
            ⭐ MILESTONE ⭐
          </div>
        )}
        <div className="text-3xl font-bold text-foreground tabular-nums">
          LEVEL {levelUp.level}
        </div>
        <div className="text-sm text-foreground-muted">
          {player.characterClass.emoji} {player.characterClass.name}
        </div>
      </button>
    </div>,
    document.body
  );
}
