import type { ProviderSummary } from "./ipc";
import { providerForModel } from "./providerMatch";

/** One row of a session's "Open with …" context menu. */
export interface OpenWithOption {
  /** Provider profile id to resume the session on. */
  providerId: string;
  /** Row text, e.g. "Open with Claude (current)". */
  label: string;
  current: boolean;
}

/**
 * The "Open with …" rows for resuming a session: one per provider profile,
 * the session's current provider first and marked "(current)". The current
 * provider is the profile whose pinned model matches the transcript's
 * recorded model; no match means the session ran on the default profile,
 * which is the first in the list (the backend's built-in ordering contract).
 * Non-current providers keep their profile order (sort is stable).
 */
export function openWithOptions(
  model: string | null | undefined,
  providers: ProviderSummary[]
): OpenWithOption[] {
  if (providers.length === 0) return [];
  const currentId = providerForModel(model, providers) ?? providers[0].id;
  return providers
    .map((p) => ({
      providerId: p.id,
      current: p.id === currentId,
      label: `Open with ${p.label}${p.id === currentId ? " (current)" : ""}`,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}
