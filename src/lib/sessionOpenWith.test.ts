import { describe, it, expect } from "vitest";
import { openWithOptions } from "./sessionOpenWith";
import type { ProviderSummary } from "./ipc";

const claude: ProviderSummary = {
  id: "claude",
  label: "Claude",
  contextWindow: 1048576,
  model: null,
};
const kimi: ProviderSummary = {
  id: "kimi",
  label: "Kimi",
  contextWindow: 1048576,
  model: "k3[1m]",
};
const providers = [claude, kimi];

describe("openWithOptions", () => {
  it("puts the current provider first and marks it", () => {
    // A Claude session (model doesn't match any pinned profile model).
    expect(openWithOptions("claude-fable-5", providers)).toEqual([
      { providerId: "claude", label: "Open with Claude (current)", current: true },
      { providerId: "kimi", label: "Open with Kimi", current: false },
    ]);
  });

  it("marks the matched profile for a pinned-model session", () => {
    expect(openWithOptions("k3", providers)).toEqual([
      { providerId: "kimi", label: "Open with Kimi (current)", current: true },
      { providerId: "claude", label: "Open with Claude", current: false },
    ]);
  });

  it("treats a missing model as the default (first) provider", () => {
    expect(openWithOptions(null, providers)[0].providerId).toBe("claude");
  });

  it("keeps non-current providers in profile order", () => {
    const extra: ProviderSummary = {
      id: "glm",
      label: "GLM",
      contextWindow: null,
      model: "glm-5",
    };
    const ids = openWithOptions("k3", [claude, kimi, extra]).map(
      (o) => o.providerId
    );
    expect(ids).toEqual(["kimi", "claude", "glm"]);
  });

  it("returns nothing while the provider list is empty", () => {
    expect(openWithOptions("k3", [])).toEqual([]);
  });
});
