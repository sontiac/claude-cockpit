import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useProviders } from "../../hooks/useProviders";

interface ProviderMenuProps {
  /** Spawn a new terminal on the picked provider profile id. */
  onPick: (providerId: string) => void;
}

/**
 * Companion to the "new terminal" button: a chevron that opens a popover
 * listing every provider profile, so a terminal can be spawned on a
 * non-default backend (e.g. Kimi). Renders nothing while there is no actual
 * choice (fewer than two providers).
 *
 * Portaled to document.body for the same reason as MoveToWorkspaceMenu: the
 * toolbar's backdrop-filter creates a stacking context that would paint the
 * canvas over an inline popover.
 */
export function ProviderMenu({ onPick }: ProviderMenuProps) {
  const providers = useProviders();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Anchor the fixed-position popover to the trigger button when opening.
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [open]);

  // A fixed-position menu must not drift from its anchor: close on any
  // scroll/resize as well as outside clicks and Escape.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (providers.length < 2) return null;

  return (
    <>
      <button
        ref={buttonRef}
        title="New terminal with provider…"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="p-1 -ml-1 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
      >
        <ChevronDown size={12} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[9rem] rounded-md border border-card-border bg-background-secondary/95 backdrop-blur-xl shadow-lg py-1"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-foreground-muted/60">
              New terminal
            </div>
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(p.id);
                  setOpen(false);
                }}
                className="w-full px-2 py-1.5 text-left text-xs text-foreground hover:bg-white/10"
              >
                {p.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
