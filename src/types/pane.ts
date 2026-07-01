import type { TerminalInfo } from "./terminal";

/** A note pane's runtime state (content lives in its own file, keyed by id). */
export interface NotePane {
  id: string;
  label: string;
  color: string;
  workspaceId: string;
}

/** The persisted note-pane shape written to notes/windows/{label}.json. */
export interface PersistedNote {
  id: string;
  label: string;
  color: string;
  workspace_id: string | null;
}

/** A pane on the canvas: either a live terminal or a note. */
export type Pane =
  | ({ kind: "terminal" } & TerminalInfo)
  | ({ kind: "note" } & NotePane);
