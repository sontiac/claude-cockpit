import { useState, useEffect, useRef } from "react";
import { Palette, Check, Upload, Trash2 } from "lucide-react";
import type { Theme } from "../../lib/themes";

interface ThemePickerProps {
  themes: Theme[];
  currentId: string;
  onSelect: (id: string) => void;
  onUpload: () => void;
  onRemove: (id: string) => void;
}

/**
 * Compact background-theme switcher for the status bar. Opens a popover of image
 * thumbnails above the button; selecting one applies it immediately. Custom
 * uploads can be removed, and a row at the bottom adds a new one from disk.
 */
export function ThemePicker({
  themes,
  currentId,
  onSelect,
  onUpload,
  onRemove,
}: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-0.5 rounded hover:bg-white/10 hover:text-foreground flex items-center"
        title="Background theme"
      >
        <Palette size={12} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-56 glass-card p-1.5 shadow-xl z-50 max-h-[60vh] overflow-y-auto">
          <div className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-foreground-muted/70">
            Background
          </div>
          {themes.map((theme) => {
            const active = theme.id === currentId;
            return (
              <div
                key={theme.id}
                className={`group/theme w-full flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-white/5 ${
                  active ? "bg-white/5" : ""
                }`}
              >
                <button
                  onClick={() => {
                    onSelect(theme.id);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <span
                    className="w-10 h-7 rounded border border-white/10 bg-cover bg-center flex-shrink-0"
                    style={{ backgroundImage: `url(${theme.image})` }}
                  />
                  <span className="flex-1 text-xs text-foreground truncate">
                    {theme.name}
                  </span>
                </button>
                {active && (
                  <Check size={12} className="text-accent-cyan flex-shrink-0" />
                )}
                {theme.custom && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(theme.id);
                    }}
                    className="p-0.5 rounded text-foreground-muted/50 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/theme:opacity-100 flex-shrink-0"
                    title="Remove background"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            );
          })}

          <div className="my-1 h-px bg-card-border" />
          <button
            onClick={() => {
              onUpload();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-md text-left text-xs text-foreground-muted hover:text-foreground hover:bg-white/5"
          >
            <Upload size={13} />
            Upload background…
          </button>
        </div>
      )}
    </div>
  );
}
