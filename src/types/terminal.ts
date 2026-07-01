export type TerminalStatus = "running" | "idle" | "responding" | "exited";

/** Terminal info as returned by the backend (no workspace concept there). */
export interface BackendTerminalInfo {
  id: string;
  label: string;
  color: string;
  status: TerminalStatus;
  cwd: string;
  command: string;
  project_id: string | null;
}

/** Client-side terminal: the backend info plus which workspace tab it lives in. */
export interface TerminalInfo extends BackendTerminalInfo {
  workspaceId: string;
}

/** A persisted snapshot of an open terminal, used to restore it on next launch. */
export interface PersistedTerminal {
  cwd: string;
  label: string;
  color: string;
  command: string;
  project_id: string | null;
  workspace_id: string | null;
}

/** A named workspace tab grouping terminals within one window. */
export interface Workspace {
  id: string;
  name: string;
}

/** A window's on-screen rectangle in physical pixels, for reopening in place. */
export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The full persisted state for one window (keyed by window label on disk). */
export interface WindowState {
  workspaces: Workspace[];
  terminals: PersistedTerminal[];
  active_workspace_id: string | null;
  geometry: Geometry | null;
}
