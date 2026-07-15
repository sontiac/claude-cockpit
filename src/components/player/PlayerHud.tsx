import { useState } from "react";
import { usePlayer } from "../../hooks/usePlayer";
import { formatCompact } from "../../lib/player";
import { LevelUpBurst } from "./LevelUpBurst";
import { CharacterCard } from "./CharacterCard";

/**
 * Always-visible character HUD for the status bar: level, emergent class, and
 * an XP bar filling toward the next level. Click to open the full character
 * card. On a level-up the HUD flashes AND a center-screen burst celebrates
 * (see LevelUpBurst); milestone levels get the golden treatment.
 */
export function PlayerHud() {
  const { player, levelUp } = usePlayer();
  const [cardOpen, setCardOpen] = useState(false);
  if (!player) return null;

  const { level, characterClass, progress, xp } = player;
  const openCard = () => setCardOpen(true);

  return (
    <>
      <button
        onClick={openCard}
        title={`${characterClass.emoji} ${characterClass.name} — ${characterClass.blurb}\n${xp.toLocaleString()} XP total — click for character card`}
        className="rounded px-1 -mx-1 hover:bg-white/5 cursor-pointer"
      >
        {levelUp?.milestone ? (
          <div className="flex items-center gap-1.5 font-semibold text-accent-amber animate-pulse">
            <span>⭐ LEVEL {levelUp.level} — MILESTONE!</span>
          </div>
        ) : levelUp ? (
          <div className="flex items-center gap-1.5 font-semibold text-accent-cyan animate-pulse">
            <span>▲ Level {levelUp.level}!</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span>{characterClass.emoji}</span>
              <span className="font-semibold text-foreground">Lv {level}</span>
              <span className="text-foreground-muted">
                {characterClass.name}
              </span>
            </span>
            <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-cyan transition-[width] duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="tabular-nums">{formatCompact(xp)} XP</span>
          </div>
        )}
      </button>

      {levelUp && (
        <LevelUpBurst player={player} levelUp={levelUp} onClick={openCard} />
      )}
      <CharacterCard
        player={player}
        open={cardOpen}
        onClose={() => setCardOpen(false)}
      />
    </>
  );
}
