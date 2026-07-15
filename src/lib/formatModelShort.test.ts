import { describe, it, expect } from "vitest";
import { formatModelShort } from "./constants";

describe("formatModelShort", () => {
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
