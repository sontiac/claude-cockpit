export const PROJECT_COLORS = [
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#3b82f6", // blue
  "#ef4444", // red
  "#84cc16", // lime
];

export const DEFAULT_COMMAND = "claude --dangerously-skip-permissions";

// --- Context-window usage badge ---------------------------------------------
// More tokens resident in context = more danger (degraded attention, imminent
// compaction). We grade the absolute token count into colored tiers. Thresholds
// are tuned for 1M-context sessions: comfortable below 300k, escalating through
// yellow/orange, bright red at 750k+.
export interface ContextTier {
  /** Foreground/text color for the badge. */
  color: string;
  /** Translucent background for the badge. */
  bg: string;
  /** Human label for the tooltip. */
  label: string;
}

const CONTEXT_TIERS: { max: number; tier: ContextTier }[] = [
  { max: 300_000, tier: { color: "#34d399", bg: "rgba(16, 185, 129, 0.15)", label: "Healthy context" } },
  { max: 500_000, tier: { color: "#fbbf24", bg: "rgba(245, 158, 11, 0.18)", label: "Filling up" } },
  { max: 750_000, tier: { color: "#fb923c", bg: "rgba(249, 115, 22, 0.20)", label: "Getting heavy" } },
];

const CONTEXT_TIER_DANGER: ContextTier = {
  color: "#f87171",
  bg: "rgba(239, 68, 68, 0.25)",
  label: "Danger — context nearly full",
};

export function contextTier(tokens: number): ContextTier {
  for (const { max, tier } of CONTEXT_TIERS) {
    if (tokens < max) return tier;
  }
  return CONTEXT_TIER_DANGER;
}

/** Compact token count: 980 -> "980", 21_600 -> "21k", 1_240_000 -> "1.2M". */
export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
