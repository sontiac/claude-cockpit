import { useCallback, useState } from "react";
import type { ConfirmSpec } from "../types/confirm";

interface PendingConfirm {
  spec: ConfirmSpec;
  resolve: (confirmed: boolean) => void;
}

/**
 * Promise-based confirmation for destructive actions. `window.confirm` is a
 * silent no-op in Tauri's macOS webview — wry implements no JS-dialog UI
 * delegate, so WebKit auto-answers every confirm() with "Cancel" — so
 * confirmation must be an in-app dialog. `confirm(spec)` resolves with the
 * user's answer; render `spec` + `respond` through <ConfirmDialog>.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (spec: ConfirmSpec) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          // A newer request supersedes an unanswered one; answer the old one
          // "cancel" so its caller doesn't hang. (Promise resolution is
          // idempotent, so StrictMode's double updater invocation is harmless.)
          prev?.resolve(false);
          return { spec, resolve };
        });
      }),
    []
  );

  const respond = useCallback((confirmed: boolean) => {
    setPending((prev) => {
      prev?.resolve(confirmed);
      return null;
    });
  }, []);

  return { confirm, spec: pending?.spec ?? null, respond };
}
