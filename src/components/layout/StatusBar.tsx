import { Terminal, Minus, Plus } from "lucide-react";
import type { TerminalInfo } from "../../types/terminal";
import { PlayerHud } from "../player/PlayerHud";

interface StatusBarProps {
  terminals: TerminalInfo[];
  fontSize: number;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onResetFont: () => void;
}

export function StatusBar({
  terminals,
  fontSize,
  onIncreaseFont,
  onDecreaseFont,
  onResetFont,
}: StatusBarProps) {
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

      {/* Character HUD — level, class, XP */}
      <div className="mx-auto">
        <PlayerHud />
      </div>

      {/* Font zoom — keyboard equivalents are Cmd/Ctrl +/-/0 */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onDecreaseFont}
          className="p-0.5 rounded hover:bg-white/10 hover:text-foreground"
          title="Decrease font size (⌘−)"
        >
          <Minus size={11} />
        </button>
        <button
          onClick={onResetFont}
          className="px-1 tabular-nums hover:text-foreground"
          title="Reset font size (⌘0)"
        >
          {fontSize}px
        </button>
        <button
          onClick={onIncreaseFont}
          className="p-0.5 rounded hover:bg-white/10 hover:text-foreground"
          title="Increase font size (⌘+)"
        >
          <Plus size={11} />
        </button>
      </div>
    </div>
  );
}
