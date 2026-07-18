import { useProviders } from "../../hooks/useProviders";

/**
 * Small header badge naming the provider a terminal runs on. The default
 * (Claude) renders nothing — the badge exists to flag the exception, not
 * restate the rule. Unknown ids (profile removed from providers.json while
 * the terminal lives on) fall back to showing the raw id.
 */
export function ProviderChip({ provider }: { provider: string | null }) {
  const providers = useProviders();
  if (!provider || provider === "claude") return null;
  const label = providers.find((p) => p.id === provider)?.label ?? provider;
  return (
    <span
      className="px-1.5 py-px rounded-full text-[10px] font-semibold leading-none flex-shrink-0 bg-violet-500/20 text-violet-300 whitespace-nowrap"
      title={`Running on ${label}`}
    >
      {label}
    </span>
  );
}
