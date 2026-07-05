import type { TerminalInfo } from "./terminal";

/** Fields every non-terminal canvas pane shares. */
export interface CanvasPaneBase {
  id: string;
  label: string;
  color: string;
  workspaceId: string;
}

/** A note (content lives in its own file, keyed by id). */
export type NotePane = CanvasPaneBase & { kind: "note" };

/** A read-only markdown file viewer pointed at an absolute path. */
export type MdViewerPane = CanvasPaneBase & { kind: "mdviewer"; path: string | null };

/** A pomodoro timer; durations persist, the running clock does not. */
export type PomodoroPane = CanvasPaneBase & {
  kind: "pomodoro";
  workMinutes: number;
  breakMinutes: number;
};

export type CanvasPane = NotePane | MdViewerPane | PomodoroPane;
export type CanvasPaneKind = CanvasPane["kind"];

/** The persisted pane shape written to notes/windows/{label}.json (Rust: PersistedPane). */
export interface PersistedPane {
  id: string;
  label: string;
  color: string;
  workspace_id: string | null;
  kind?: string;
  path?: string | null;
  work_minutes?: number | null;
  break_minutes?: number | null;
}

/** A pane on the canvas: a live terminal or any canvas pane. */
export type Pane = ({ kind: "terminal" } & TerminalInfo) | CanvasPane;
