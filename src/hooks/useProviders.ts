import { useEffect, useState } from "react";
import { listProviders, type ProviderSummary } from "../lib/ipc";

// Provider profiles are static for the app's lifetime (they change by editing
// a config file and relaunching), so fetch once and share across every
// consumer — N terminal headers must not mean N IPC calls.
let cache: ProviderSummary[] | null = null;
let inflight: Promise<ProviderSummary[] | null> | null = null;

async function fetchProviders(): Promise<ProviderSummary[] | null> {
  try {
    const providers = await listProviders();
    cache = providers;
    return providers;
  } catch (error) {
    // Not cached: a later mount retries instead of freezing the failure.
    console.error("Failed to list providers:", error);
    return null;
  } finally {
    inflight = null;
  }
}

/** The available provider profiles (empty while the first fetch is inflight). */
export function useProviders(): ProviderSummary[] {
  const [providers, setProviders] = useState<ProviderSummary[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    (inflight ??= fetchProviders()).then((fetched) => {
      if (alive && fetched) setProviders(fetched);
    });
    return () => {
      alive = false;
    };
  }, []);
  return providers;
}
