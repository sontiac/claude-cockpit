import { X } from "lucide-react";
import { StatusDot } from "../shared/StatusDot";
import type { TerminalInfo } from "../../types/terminal";

interface TerminalTabProps {
  terminal: TerminalInfo;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function TerminalTab({
  terminal,
  active,
  onSelect,
  onClose,
}: TerminalTabProps) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b-2 transition-colors min-w-0 max-w-[180px] ${
        active
          ? "border-accent-cyan bg-white/5"
          : "border-transparent hover:bg-white/5"
      }`}
    >
      <StatusDot status={terminal.status} />
      <span
        className="text-xs truncate flex-1"
        style={{ color: active ? terminal.color : undefined }}
      >
        {terminal.label}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-foreground-muted hover:text-foreground"
      >
        <X size={12} />
      </button>
    </div>
  );
}
