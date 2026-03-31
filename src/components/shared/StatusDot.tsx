import type { TerminalStatus } from "../../types/terminal";

const statusColors: Record<TerminalStatus, string> = {
  running: "#3b82f6",
  idle: "#10b981",
  responding: "#f59e0b",
  exited: "#475569",
};

export function StatusDot({ status }: { status: TerminalStatus }) {
  const color = statusColors[status];
  const shouldPulse = status === "responding";

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${shouldPulse ? "status-pulse" : ""}`}
      style={{ backgroundColor: color }}
      title={status}
    />
  );
}
