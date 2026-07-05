import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BackendTerminalInfo,
  WindowState,
  Geometry,
} from "../types/terminal";
import type { Session, SessionContext } from "../types/session";
import type { Project } from "../types/project";
import type { PersistedPane } from "../types/pane";
import type { PlayerStats } from "./player";

// Terminal commands
export const ptySpawn = (params: {
  id: string;
  cwd: string;
  command?: string;
  label: string;
  color: string;
  projectId?: string;
}) =>
  invoke<BackendTerminalInfo>("pty_spawn", {
    id: params.id,
    cwd: params.cwd,
    command: params.command ?? null,
    label: params.label,
    color: params.color,
    projectId: params.projectId ?? null,
  });

export const ptyWrite = (id: string, data: string) =>
  invoke<void>("pty_write", { id, data });

export const ptyResize = (id: string, cols: number, rows: number) =>
  invoke<void>("pty_resize", { id, cols, rows });

export const ptyKill = (id: string) => invoke<void>("pty_kill", { id });

export const getTerminals = () =>
  invoke<BackendTerminalInfo[]>("get_terminals");

/** Open a new independent app window (its own workspaces + terminals).
 *  Pass a label + geometry to recreate a saved window in place. */
export const openWindow = (label?: string, geometry?: Geometry) =>
  invoke<void>("open_window", {
    label: label ?? null,
    geometry: geometry ?? null,
  });

/** Cleanly quit the whole app (kills child processes, then exits). */
export const quitApp = () => invoke<void>("quit_app");

/** Cycle window focus to the next/previous cockpit window. */
export const cycleWindow = (direction: "next" | "prev") =>
  invoke<void>("cycle_window", { direction });

// Session commands
export const getSessions = (limit?: number, projectPath?: string) =>
  invoke<Session[]>("get_sessions", {
    limit: limit ?? null,
    projectPath: projectPath ?? null,
  });

export const getProjectPaths = () => invoke<string[]>("get_project_paths");

export const getSessionContext = (sessionId: string, cwd: string) =>
  invoke<SessionContext | null>("get_session_context", { sessionId, cwd });

// Player stats (gamification) — lifetime aggregates across all sessions
export const getPlayerStats = () => invoke<PlayerStats>("get_player_stats");

// Project commands
export const getProjects = () => invoke<Project[]>("get_projects");

export const addProject = (project: Project) =>
  invoke<Project[]>("add_project", { ...project });

export const updateProject = (project: Project) =>
  invoke<Project[]>("update_project", { ...project });

export const deleteProject = (id: string) =>
  invoke<Project[]>("delete_project", { id });

export const reorderProjects = (orderedIds: string[]) =>
  invoke<Project[]>("reorder_projects", { orderedIds });

// Per-window session persistence (each window saves under its own label)
export const getWindowState = (label: string) =>
  invoke<WindowState>("get_window_state", { label });

export const saveWindowState = (label: string, state: WindowState) =>
  invoke<void>("save_window_state", { label, state });

/** Labels of all windows with saved state, for recreating a session. */
export const listSessionLabels = () =>
  invoke<string[]>("list_session_labels");

/** Forget one window's saved session (so a deliberately-closed window is not
 *  offered for recovery next launch). */
export const removeWindowState = (label: string) =>
  invoke<void>("remove_window_state", { label });

/** Discard the entire saved session (all windows). */
export const clearSession = () => invoke<void>("clear_session");

// Notes commands
export const getWindowNotes = (label: string) =>
  invoke<PersistedPane[]>("get_window_notes", { label });

export const saveWindowNotes = (label: string, notes: PersistedPane[]) =>
  invoke<void>("save_window_notes", { label, notes });

export const getNoteContent = (id: string) =>
  invoke<unknown | null>("get_note_content", { id });

// Tombstone set: once a note's content has been deleted, any later save for
// that id is ignored. This exists because deletion (removeNoteContent) and
// the editor's unmount-flush (saveNoteContent) can fire concurrently — e.g.
// closing a note within ~500ms of an edit — and race across the IPC
// boundary to the backend's thread pool, where invocation order on the
// frontend does not guarantee completion order on the backend. If the save
// lands after the delete, it would recreate an orphaned content file with
// no corresponding pane-list entry. Note ids are UUIDs that are never
// reused, so this set only grows by notes deleted within the current
// session — negligible, and deliberately never evicted.
const deletedNoteContent = new Set<string>();

export const saveNoteContent = (id: string, content: unknown) => {
  if (deletedNoteContent.has(id)) return Promise.resolve();
  return invoke<void>("save_note_content", { id, content });
};

export const removeNoteContent = (id: string) => {
  deletedNoteContent.add(id);
  return invoke<void>("remove_note_content", { id });
};

export const clearNotes = () => invoke<void>("clear_notes");

/** Remove one window's note-pane list (used when a window is closed and
 *  forgotten; the notes' content files are deleted separately via
 *  removeNoteContent). */
export const removeWindowNotes = (label: string) =>
  invoke<void>("remove_window_notes", { label });

export const setSessionTitle = (sessionId: string, title: string) =>
  invoke<void>("set_session_title", { sessionId, title });

// System commands
export interface BrowseResult {
  current_path: string;
  parent_path: string | null;
  directories: { name: string; path: string; is_dir: boolean }[];
}

export const browseDirectory = (path: string) =>
  invoke<BrowseResult>("browse_directory", { path });

export const getHomeDir = () => invoke<string>("get_home_dir");

// Custom background images (user uploads)
export interface BackgroundInfo {
  id: string;
  name: string;
  /** Absolute filesystem path; turn into a loadable URL with `assetUrl`. */
  path: string;
}

export const listBackgrounds = () =>
  invoke<BackgroundInfo[]>("list_backgrounds");

/** Opens a native image picker; resolves to the imported background, or null if cancelled. */
export const importBackground = () =>
  invoke<BackgroundInfo | null>("import_background");

export const deleteBackground = (id: string) =>
  invoke<BackgroundInfo[]>("delete_background", { id });

/** Convert an absolute file path into a webview-loadable asset:// URL. */
export const assetUrl = (path: string) => convertFileSrc(path);

// Event listeners
export const onTerminalOutput = (
  id: string,
  callback: (data: number[]) => void
): Promise<UnlistenFn> =>
  listen<{ data: number[] }>(`terminal:output:${id}`, (event) =>
    callback(event.payload.data)
  );

export const onTerminalStatus = (
  id: string,
  callback: (status: string) => void
): Promise<UnlistenFn> =>
  listen<{ status: string }>(`terminal:status:${id}`, (event) =>
    callback(event.payload.status)
  );

export const onTerminalExit = (
  id: string,
  callback: (code: number | null) => void
): Promise<UnlistenFn> =>
  listen<{ code: number | null }>(`terminal:exit:${id}`, (event) =>
    callback(event.payload.code)
  );
