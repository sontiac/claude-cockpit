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
  /** Provider profile id this terminal runs on (null = default Claude). */
  provider: string | null;
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
  provider: string | null;
}

/** A named workspace tab grouping terminals within one window. */
export interface Workspace {
  id: string;
  name: string;
}

/** A window's on-screen rectangle in logical points, for reopening in place.
 *  Logical (not physical) because physical pixels are ambiguous across
 *  mixed-DPI monitors — see `toLogicalFrame` in lib/frame.ts. */
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
  frame: Geometry | null;
  /** Sidebar docked (pinned) vs hidden-with-edge-hover. Default false. */
  sidebar_pinned: boolean;
}
