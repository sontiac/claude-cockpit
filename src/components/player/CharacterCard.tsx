import { Modal } from "../shared/Modal";
import { formatCompact, nextMilestone, type Player } from "../../lib/player";
import { artForPlayer } from "../../lib/playerArt";

interface CharacterCardProps {
  player: Player;
  open: boolean;
  onClose: () => void;
}

/** One lifetime stat tile in the character card's grid. */
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-card-border px-3 py-2">
      <div className="text-sm font-semibold text-foreground tabular-nums">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-foreground-muted">
        {label}
      </div>
    </div>
  );
}

/**
 * The developer's character sheet: portrait, level, emergent class, XP
 * progress with exact numbers, and lifetime stats. Opened from the status-bar
 * HUD or by clicking a level-up burst.
 */
export function CharacterCard({ player, open, onClose }: CharacterCardProps) {
  const { level, xp, xpIntoLevel, xpForLevel, progress, characterClass, stats } =
    player;
  return (
    <Modal open={open} onClose={onClose} title="Character">
      <div className="flex flex-col items-center gap-4">
        <img
          src={artForPlayer(characterClass.key, level)}
          alt={characterClass.name}
          className="w-44 h-44 rounded-xl object-cover border border-card-border"
        />
        <div className="text-center">
          <div className="text-2xl font-bold text-foreground">
            Level {level}
          </div>
          <div className="text-sm text-foreground-muted">
            {characterClass.emoji} {characterClass.name} — {characterClass.blurb}
          </div>
        </div>

        <div className="w-full">
          <div className="flex justify-between text-xs text-foreground-muted mb-1 tabular-nums">
            <span>
              {xpIntoLevel.toLocaleString()} / {xpForLevel.toLocaleString()} XP
            </span>
            <span>{formatCompact(xp)} total</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-cyan"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-foreground-muted mt-1">
            Next milestone: Level {nextMilestone(level)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 w-full">
          <StatTile
            label="Output tokens"
            value={formatCompact(stats.outputTokens)}
          />
          <StatTile label="Messages" value={formatCompact(stats.userMessages)} />
          <StatTile label="Tool calls" value={formatCompact(stats.toolCalls)} />
          <StatTile label="Sessions" value={String(stats.sessions)} />
          <StatTile label="Projects" value={String(stats.projects)} />
        </div>
      </div>
    </Modal>
  );
}
