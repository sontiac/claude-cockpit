import { usePlayer } from "../../hooks/usePlayer";
import { formatCompact } from "../../lib/player";

/**
 * Always-visible character HUD for the status bar: level, emergent class, and an
 * XP bar that fills toward the next level. On a level-up it swaps to a flashing
 * celebration for a few seconds (the audio + notification fire from usePlayer).
 */
export function PlayerHud() {
  const { player, levelUp } = usePlayer();
  if (!player) return null;

  // Milestone level-up: big golden celebration.
  if (levelUp?.milestone) {
    return (
      <div className="flex items-center gap-1.5 font-semibold text-accent-amber animate-pulse">
        <span>⭐ LEVEL {levelUp.level} — MILESTONE!</span>
      </div>
    );
  }

  const { level, characterClass, progress, xp } = player;

  // Ordinary level-up: brief cyan pulse on the level badge.
  if (levelUp) {
    return (
      <div className="flex items-center gap-1.5 font-semibold text-accent-cyan animate-pulse">
        <span>▲ Level {levelUp.level}!</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2"
      title={`${characterClass.emoji} ${characterClass.name} — ${characterClass.blurb}\n${xp.toLocaleString()} XP total`}
    >
      <span className="flex items-center gap-1">
        <span>{characterClass.emoji}</span>
        <span className="font-semibold text-foreground">Lv {level}</span>
        <span className="text-foreground-muted">{characterClass.name}</span>
      </span>
      <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent-cyan transition-[width] duration-500"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <span className="tabular-nums">{formatCompact(xp)} XP</span>
    </div>
  );
}
