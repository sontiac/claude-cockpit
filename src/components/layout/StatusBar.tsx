import { Terminal, Minus, Plus } from "lucide-react";
import type { TerminalInfo } from "../../types/terminal";
import type { Theme } from "../../lib/themes";
import { PlayerHud } from "../player/PlayerHud";
import { ThemePicker } from "./ThemePicker";

interface StatusBarProps {
  terminals: TerminalInfo[];
  fontSize: number;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onResetFont: () => void;
  themes: Theme[];
  currentThemeId: string;
  onSelectTheme: (id: string) => void;
  onUploadTheme: () => void;
  onRemoveTheme: (id: string) => void;
}

export function StatusBar({
  terminals,
  fontSize,
  onIncreaseFont,
  onDecreaseFont,
  onResetFont,
  themes,
  currentThemeId,
  onSelectTheme,
  onUploadTheme,
  onRemoveTheme,
}: StatusBarProps) {
  const active = terminals.filter((t) => t.status !== "exited").length;
  const responding = terminals.filter((t) => t.status === "responding").length;

  return (
    <div className="h-6 flex items-center px-3 bg-background/30 backdrop-blur-2xl border-t border-white/10 text-xs text-foreground-muted select-none">
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
      <div className="flex items-center gap-1">
        <ThemePicker
          themes={themes}
          currentId={currentThemeId}
          onSelect={onSelectTheme}
          onUpload={onUploadTheme}
          onRemove={onRemoveTheme}
        />
        <div className="w-px h-3 bg-card-border" />
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
