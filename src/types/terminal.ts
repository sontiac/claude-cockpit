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

/** A persisted snapshot of an open terminal, used to restore it on next launch. */
export interface PersistedTerminal {
  cwd: string;
  label: string;
  color: string;
  command: string;
  project_id: string | null;
}
