export type TerminalStatus = "running" | "idle" | "responding" | "exited";

export interface TerminalInfo {
  id: string;
  label: string;
  color: string;
  status: TerminalStatus;
  cwd: string;
  command: string;
  project_id: string | null;
}
