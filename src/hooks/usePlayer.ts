import { useEffect, useRef, useState } from "react";
import { getPlayerStats } from "../lib/ipc";
import { derivePlayer, isMilestoneCrossed, type Player } from "../lib/player";
import { useSounds } from "./useSounds";
import { useNotifications } from "./useNotifications";

// Poll cadence for lifetime stats. The first call may take a few seconds (full
// transcript scan, off the UI thread); every call after reads only appended
// bytes, so this stays cheap.
const POLL_MS = 5000;
// How long the HUD celebration lingers — milestones longer than ordinary dings.
const MILESTONE_FLASH_MS = 4500;
const LEVEL_FLASH_MS = 1800;

/** A pending level-up celebration: the new level and whether it's a milestone. */
export interface LevelUp {
  level: number;
  milestone: boolean;
}

/**
 * Live player progression. Polls lifetime stats, derives level/class/XP, and on
 * a level increase fires the dopamine. Ordinary levels get a quiet ding + brief
 * HUD pulse; milestone levels (every Nth) also get the full fanfare + an OS
 * notification. The very first poll only seeds the baseline level, so launching
 * the app never spuriously "levels you up".
 */
export function usePlayer() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  const prevLevelRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number>(0);

  const { play } = useSounds();
  const { notify } = useNotifications();
  // Read effects through refs so the poller effect can depend on nothing and
  // never re-subscribe.
  const playRef = useRef(play);
  playRef.current = play;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const stats = await getPlayerStats();
        if (cancelled) return;
        const p = derivePlayer(stats);
        setPlayer(p);

        const prev = prevLevelRef.current;
        if (prev !== null && p.level > prev) {
          const milestone = isMilestoneCrossed(prev, p.level);
          if (milestone) {
            playRef.current("levelup");
            notifyRef.current(
              "⭐ Milestone!",
              `You reached Level ${p.level} — ${p.characterClass.name}`
            );
          } else {
            playRef.current("ding");
          }
          setLevelUp({ level: p.level, milestone });
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = window.setTimeout(
            () => {
              setLevelUp(null);
              flashTimerRef.current = 0;
            },
            milestone ? MILESTONE_FLASH_MS : LEVEL_FLASH_MS
          );
        }
        prevLevelRef.current = p.level;
      } catch (err) {
        console.error("Failed to load player stats:", err);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  return { player, levelUp };
}
