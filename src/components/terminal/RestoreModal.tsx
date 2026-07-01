import { useState } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";

interface RestoreModalProps {
  open: boolean;
  terminalCount: number;
  windowCount: number;
  onRecover: () => void;
  onDiscard: () => void;
}

/**
 * Session-recovery prompt shown on launch. Deliberately NOT dismissable by
 * clicking outside or pressing Escape — losing a screenful of terminals to a
 * stray click is the exact thing we're guarding against. Discarding requires a
 * second, explicit confirmation.
 */
export function RestoreModal({
  open,
  terminalCount,
  windowCount,
  onRecover,
  onDiscard,
}: RestoreModalProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  if (!open) return null;

  const termLabel = `${terminalCount} terminal${terminalCount !== 1 ? "s" : ""}`;
  const windowLabel =
    windowCount > 1 ? ` across ${windowCount} windows` : "";

  return (
    // No onClick-to-close on the backdrop: this modal is intentionally modal.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card p-6 w-full max-w-md mx-4">
        {!confirmingDiscard ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <RotateCcw size={18} className="text-accent-cyan" />
              <h2 className="text-lg font-semibold text-foreground">
                Recover your session?
              </h2>
            </div>
            <p className="text-sm text-foreground-muted mb-5">
              You had <span className="text-foreground font-medium">{termLabel}</span>
              {windowLabel} open when Cockpit last closed. Recover them and pick up
              where you left off?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmingDiscard(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-white/5"
              >
                No, start fresh
              </button>
              <button
                autoFocus
                onClick={onRecover}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30 font-medium text-sm"
              >
                <RotateCcw size={15} />
                Recover
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-400" />
              <h2 className="text-lg font-semibold text-foreground">
                Are you sure?
              </h2>
            </div>
            <p className="text-sm text-foreground-muted mb-5">
              This permanently discards <span className="text-foreground font-medium">
              {termLabel}</span>{windowLabel}. They can't be recovered afterwards.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                autoFocus
                onClick={() => setConfirmingDiscard(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-white/5"
              >
                Go back
              </button>
              <button
                onClick={onDiscard}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 text-red-300 hover:bg-red-500/30 font-medium text-sm"
              >
                Yes, discard all
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
