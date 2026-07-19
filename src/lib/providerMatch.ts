import type { ProviderSummary } from "./ipc";

/** Strip the `[1m]` context-tier suffix — an env-var naming convention, not
 *  part of the model's identity ("k3[1m]" and "k3" are the same model). */
const bare = (id: string) => id.replace(/\[1m\]$/, "");

/**
 * The provider profile a recorded model id belongs to, for resuming a chat on
 * the backend it originally ran on. Returns undefined (= default provider)
 * for Claude models, unknown models, or when nothing matches — resuming on
 * the default is the safe fallback, never an error.
 */
export function providerForModel(
  model: string | null | undefined,
  providers: ProviderSummary[]
): string | undefined {
  if (!model) return undefined;
  const m = bare(model);
  return providers.find((p) => p.model && bare(p.model) === m)?.id;
}
