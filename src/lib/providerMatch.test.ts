import { describe, it, expect } from "vitest";
import { providerForModel } from "./providerMatch";
import type { ProviderSummary } from "./ipc";

const providers: ProviderSummary[] = [
  { id: "claude", label: "Claude", contextWindow: 1048576, model: null },
  { id: "kimi", label: "Kimi", contextWindow: 1048576, model: "k3[1m]" },
];

describe("providerForModel", () => {
  it("maps a transcript's recorded model to its provider", () => {
    // Transcripts record the bare id ("k3"); the profile pins "k3[1m]" —
    // the [1m] suffix is an env-var convention, same model.
    expect(providerForModel("k3", providers)).toBe("kimi");
    expect(providerForModel("k3[1m]", providers)).toBe("kimi");
  });

  it("returns undefined for Claude models (default provider)", () => {
    expect(providerForModel("claude-fable-5", providers)).toBeUndefined();
  });

  it("returns undefined for unknown models or missing input", () => {
    expect(providerForModel("kimi-k2.7-code", providers)).toBeUndefined();
    expect(providerForModel(null, providers)).toBeUndefined();
    expect(providerForModel("k3", [])).toBeUndefined();
  });
});
