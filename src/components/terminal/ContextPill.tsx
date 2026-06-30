import { contextTier, formatTokens } from "../../lib/constants";

interface ContextPillProps {
  tokens: number;
}

/**
 * A compact badge showing how many tokens are resident in a session's context
 * window, colored by severity (green → yellow → orange → red). More context =
 * more danger, so the color escalates as the window fills.
 */
export function ContextPill({ tokens }: ContextPillProps) {
  const tier = contextTier(tokens);
  return (
    <span
      className="px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums leading-none flex-shrink-0"
      style={{ color: tier.color, backgroundColor: tier.bg }}
      title={`${tier.label} — ${tokens.toLocaleString()} tokens in context`}
    >
      {formatTokens(tokens)}
    </span>
  );
}
