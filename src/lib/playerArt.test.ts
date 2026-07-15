import { describe, it, expect } from "vitest";
import { tierForLevel, nextMilestone, CLASSES } from "./player";
import { artForPlayer } from "./playerArt";

describe("tierForLevel", () => {
  it("maps level brackets to tiers 1-5", () => {
    expect(tierForLevel(1)).toBe(1);
    expect(tierForLevel(49)).toBe(1);
    expect(tierForLevel(50)).toBe(2);
    expect(tierForLevel(99)).toBe(2);
    expect(tierForLevel(100)).toBe(3);
    expect(tierForLevel(199)).toBe(4);
    expect(tierForLevel(200)).toBe(5);
    expect(tierForLevel(224)).toBe(5);
    expect(tierForLevel(9999)).toBe(5);
  });
});

describe("nextMilestone", () => {
  it("returns the next multiple of 25 strictly above the level", () => {
    expect(nextMilestone(1)).toBe(25);
    expect(nextMilestone(24)).toBe(25);
    expect(nextMilestone(25)).toBe(50);
    expect(nextMilestone(224)).toBe(225);
  });
});

describe("artForPlayer", () => {
  it("resolves an asset for every class x tier", () => {
    for (const key of Object.keys(CLASSES)) {
      for (const level of [1, 60, 120, 180, 250]) {
        const url = artForPlayer(key, level);
        expect(url, `${key} level ${level}`).toBeTruthy();
      }
    }
  });

  it("falls back to the adventurer art for unknown class keys", () => {
    expect(artForPlayer("nonsense", 10)).toBe(artForPlayer("adventurer", 10));
  });

  // Guards against a missing asset being masked by the adventurer fallback:
  // the resolve-test above still passes if e.g. archmage-t3.png is deleted.
  it("bundles exactly the 25 class × tier assets", () => {
    const images = import.meta.glob("../assets/player/*.png", {
      eager: true,
      import: "default",
    }) as Record<string, string>;
    for (const key of Object.keys(CLASSES)) {
      for (const tier of [1, 2, 3, 4, 5]) {
        expect(images[`../assets/player/${key}-t${tier}.png`], `${key}-t${tier}`).toBeTruthy();
      }
    }
    expect(Object.keys(images)).toHaveLength(25);
  });
});
