import { tierForLevel } from "./player";

// Every bundled portrait, keyed by its source path. Eager so a missing file
// fails tests at import time rather than rendering a broken <img> at runtime.
const images = import.meta.glob("../assets/player/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

function artPath(classKey: string, tier: number): string {
  return `../assets/player/${classKey}-t${tier}.png`;
}

/**
 * Bundled portrait URL for a class at a level. Unknown class keys fall back to
 * the adventurer portrait of the same tier.
 */
export function artForPlayer(classKey: string, level: number): string {
  const tier = tierForLevel(level);
  return images[artPath(classKey, tier)] ?? images[artPath("adventurer", tier)] ?? "";
}
