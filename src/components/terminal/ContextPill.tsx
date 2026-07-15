import { contextTier, formatTokens, formatModelShort } from "../../lib/constants";

interface ContextPillProps {
  tokens: number;
  model?: string | null;
  effort?: string | null;
}

/**
 * Compact header readout: "Fable 5 · high · 74k". Model and effort are muted
 * text; the token count keeps its severity-colored badge (green → red as the
 * context window fills). In narrow panes, container queries in globals.css
 * hide `.pill-effort` first and `.pill-model` second — tokens are always last
 * to go (and never do).
 */
export function ContextPill({ tokens, model, effort }: ContextPillProps) {
  const tier = contextTier(tokens);
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0 min-w-0">
      {model && (
        <span className="pill-model text-[10px] text-foreground-muted whitespace-nowrap">
          {formatModelShort(model)}
        </span>
      )}
      {effort && (
        <span className="pill-effort text-[10px] text-foreground-muted whitespace-nowrap">
          {effort}
        </span>
      )}
      <span
        className="px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums leading-none flex-shrink-0"
        style={{ color: tier.color, backgroundColor: tier.bg }}
        title={`${tier.label} — ${tokens.toLocaleString()} tokens in context`}
      >
        {formatTokens(tokens)}
      </span>
    </span>
  );
}
