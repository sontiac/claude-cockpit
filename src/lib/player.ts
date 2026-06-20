// Player progression rules. All pure and dependency-free so the numbers are
// easy to tune and reason about. The single global character IS the developer:
// lifetime stats across every Claude session feed one level, one class, one XP
// total. (Per-project "characters" are a possible later layer; this is global.)

/** Lifetime aggregates from the Rust stats aggregator (serde camelCase). */
export interface PlayerStats {
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Genuine user prompts (not tool-result records). */
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  sessions: number;
  projects: number;
}

// --- XP -------------------------------------------------------------------
// Output tokens are the core "work done" signal. Cache-read tokens are excluded
// on purpose: they're mostly free reuse and dwarf everything else (billions vs
// millions), so they'd swamp the formula and reward nothing real.
const XP_PER_OUTPUT_TOKEN = 1 / 1000;
const XP_PER_MESSAGE = 10;
const XP_PER_TOOL_CALL = 2;
const XP_PER_SESSION = 25;

export function totalXp(s: PlayerStats): number {
  return Math.floor(
    s.outputTokens * XP_PER_OUTPUT_TOKEN +
      s.userMessages * XP_PER_MESSAGE +
      s.toolCalls * XP_PER_TOOL_CALL +
      s.sessions * XP_PER_SESSION
  );
}

// --- Levels ---------------------------------------------------------------
// Quadratic curve: cumulative XP to reach level L is LEVEL_BASE * (L-1)^2. Since
// level grows with the square root of XP, you gain levels frequently and they
// taper gently as you climb — many small dings forever, never a plateau and
// never a cap. levelForXp is the exact inverse. A smaller LEVEL_BASE = more,
// faster levels.
const LEVEL_BASE = 10;

export function xpToReachLevel(level: number): number {
  const l = Math.max(1, level);
  return LEVEL_BASE * (l - 1) * (l - 1);
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / LEVEL_BASE)) + 1;
}

// Every Nth level is a milestone: it earns the full fanfare + OS notification,
// while ordinary levels get only a quiet ding + HUD pulse. This keeps frequent
// leveling rewarding without turning into notification spam.
export const MILESTONE_EVERY = 25;

export function isMilestoneCrossed(prevLevel: number, newLevel: number): boolean {
  return (
    Math.floor(newLevel / MILESTONE_EVERY) > Math.floor(prevLevel / MILESTONE_EVERY)
  );
}

// --- Class ----------------------------------------------------------------
// The class is earned, not chosen: it emerges from how you actually work. Each
// candidate scores its signature metric against a rough baseline; the strongest
// tendency wins, but only if it's meaningfully above baseline — otherwise you're
// a balanced Adventurer. Baselines are tunable.
export interface CharacterClass {
  key: string;
  name: string;
  emoji: string;
  blurb: string;
}

export const CLASSES: Record<string, CharacterClass> = {
  archmage: {
    key: "archmage",
    name: "Archmage",
    emoji: "🧙",
    blurb: "Channels raw tokens — deep, sprawling sessions.",
  },
  artificer: {
    key: "artificer",
    name: "Artificer",
    emoji: "🛠️",
    blurb: "Tool-slinger — builds more than talks.",
  },
  duelist: {
    key: "duelist",
    name: "Duelist",
    emoji: "⚔️",
    blurb: "Rapid-fire — many moves per session.",
  },
  berserker: {
    key: "berserker",
    name: "Berserker",
    emoji: "🔥",
    blurb: "Long autonomous runs — lets Claude cook.",
  },
  adventurer: {
    key: "adventurer",
    name: "Adventurer",
    emoji: "🧭",
    blurb: "A balanced all-rounder.",
  },
};

export function deriveClass(s: PlayerStats): CharacterClass {
  if (s.userMessages === 0 || s.sessions === 0) return CLASSES.adventurer;

  const tokensPerMsg = s.outputTokens / s.userMessages;
  const toolsPerMsg = s.toolCalls / s.userMessages;
  const msgsPerSession = s.userMessages / s.sessions;
  const assistantPerUser = s.assistantMessages / Math.max(1, s.userMessages);

  const candidates = [
    { cls: CLASSES.archmage, score: tokensPerMsg / 3000 },
    { cls: CLASSES.artificer, score: toolsPerMsg / 1.0 },
    { cls: CLASSES.duelist, score: msgsPerSession / 20 },
    { cls: CLASSES.berserker, score: assistantPerUser / 3.0 },
  ];
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].score >= 1.0 ? candidates[0].cls : CLASSES.adventurer;
}

// --- Derived player -------------------------------------------------------
export interface Player {
  stats: PlayerStats;
  xp: number;
  level: number;
  /** XP earned into the current level. */
  xpIntoLevel: number;
  /** XP span of the current level (floor → next). */
  xpForLevel: number;
  /** 0..1 progress toward the next level. */
  progress: number;
  characterClass: CharacterClass;
}

export function derivePlayer(stats: PlayerStats): Player {
  const xp = totalXp(stats);
  const level = levelForXp(xp);
  const floor = xpToReachLevel(level);
  const next = xpToReachLevel(level + 1);
  const xpForLevel = Math.max(1, next - floor);
  const xpIntoLevel = xp - floor;
  return {
    stats,
    xp,
    level,
    xpIntoLevel,
    xpForLevel,
    progress: Math.min(1, Math.max(0, xpIntoLevel / xpForLevel)),
    characterClass: deriveClass(stats),
  };
}

/** Compact number formatting: 283922 → "283.9k", 69178787 → "69.2M". */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
