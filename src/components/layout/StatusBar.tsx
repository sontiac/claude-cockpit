import { Terminal } from "lucide-react";
import type { TerminalInfo } from "../../types/terminal";

interface StatusBarProps {
  terminals: TerminalInfo[];
}

export function StatusBar({ terminals }: StatusBarProps) {
  const active = terminals.filter((t) => t.status !== "exited").length;
  const responding = terminals.filter((t) => t.status === "responding").length;

  return (
    <div className="h-6 flex items-center px-3 bg-background/80 border-t border-card-border text-xs text-foreground-muted select-none">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Terminal size={11} />
          {active} terminal{active !== 1 ? "s" : ""}
        </span>
        {responding > 0 && (
          <span className="text-accent-amber">
            {responding} responding
          </span>
        )}
      </div>
    </div>
  );
}
