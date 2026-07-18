import { describe, it, expect } from "vitest";
import { contextTier, formatModelShort } from "./constants";

describe("formatModelShort", () => {
  it("formats Kimi model ids", () => {
    expect(formatModelShort("kimi-k3")).toBe("Kimi K3");
    expect(formatModelShort("kimi-k2.7-code")).toBe("Kimi K2.7");
    expect(formatModelShort("kimi-k2-turbo-preview")).toBe("Kimi K2");
  });

  it("formats current model ids", () => {
    expect(formatModelShort("claude-fable-5")).toBe("Fable 5");
    expect(formatModelShort("claude-opus-4-8")).toBe("Opus 4.8");
    expect(formatModelShort("claude-sonnet-5")).toBe("Sonnet 5");
  });

  it("drops a trailing date stamp", () => {
    expect(formatModelShort("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("tolerates a [1m] context suffix", () => {
    expect(formatModelShort("claude-fable-5[1m]")).toBe("Fable 5");
  });

  it("falls back to the raw id for unknown shapes", () => {
    expect(formatModelShort("gpt-oss-120b")).toBe("gpt-oss-120b");
  });
});

describe("contextTier with a provider context window", () => {
  it("keeps the 1M-tuned tiers when no window is given", () => {
    expect(contextTier(200_000).label).toBe("Healthy context");
  });

  it("scales tier thresholds down for a smaller window", () => {
    // 200k of a 256k window is nearly full — must not read as healthy.
    expect(contextTier(200_000, 262_144).label).toBe(
      "Danger — context nearly full"
    );
  });

  it("treats a 1M window the same as the default", () => {
    expect(contextTier(400_000, 1_048_576).label).toBe(
      contextTier(400_000).label
    );
  });
});
