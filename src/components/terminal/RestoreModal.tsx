import { RotateCcw } from "lucide-react";
import { Modal } from "../shared/Modal";
import { StatusDot } from "../shared/StatusDot";
import type { PersistedTerminal } from "../../types/terminal";

interface RestoreModalProps {
  terminals: PersistedTerminal[];
  onRestore: () => void;
  onDismiss: () => void;
}

export function RestoreModal({
  terminals,
  onRestore,
  onDismiss,
}: RestoreModalProps) {
  const open = terminals.length > 0;

  return (
    <Modal
      open={open}
      onClose={onDismiss}
      title={`Restore ${terminals.length} terminal${
        terminals.length !== 1 ? "s" : ""
      }?`}
    >
      <p className="text-sm text-foreground-muted mb-4">
        These were open when you last closed Cockpit. Claude sessions resume the
        most recent conversation in their folder.
      </p>

      <div className="max-h-56 overflow-y-auto space-y-1 mb-5">
        {terminals.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5"
          >
            <StatusDot status="idle" />
            <span
              className="text-sm font-medium truncate flex-shrink-0"
              style={{ color: t.color }}
            >
              {t.label}
            </span>
            <span className="text-xs text-foreground-muted truncate ml-auto">
              {t.cwd}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onDismiss}
          className="px-4 py-2 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-white/5"
        >
          Start fresh
        </button>
        <button
          onClick={onRestore}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30 font-medium text-sm"
        >
          <RotateCcw size={15} />
          Restore
        </button>
      </div>
    </Modal>
  );
}
