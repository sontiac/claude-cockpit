import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import type { ConfirmSpec } from "../../types/confirm";

interface ConfirmDialogProps {
  /** The question to ask; null renders nothing. */
  spec: ConfirmSpec | null;
  onRespond: (confirmed: boolean) => void;
}

/**
 * In-app replacement for `window.confirm`, which Tauri's macOS webview
 * silently answers "Cancel" without showing anything. Backdrop click and
 * Cancel both answer false; only the explicit action button answers true.
 * Portaled to <body> so no backdrop-filter ancestor can trap the overlay.
 */
export function ConfirmDialog({ spec, onRespond }: ConfirmDialogProps) {
  if (!spec) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onRespond(false);
      }}
    >
      <div className="glass-card p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} className="text-red-400" />
          <h2 className="text-lg font-semibold text-foreground">{spec.title}</h2>
        </div>
        <p className="text-sm text-foreground-muted mb-5">{spec.body}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            autoFocus
            onClick={() => onRespond(false)}
            className="px-4 py-2 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={() => onRespond(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 text-red-300 hover:bg-red-500/30 font-medium text-sm"
          >
            {spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
