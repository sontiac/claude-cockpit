import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TerminalInfo } from "../types/terminal";
import type { Session } from "../types/session";
import type { Project } from "../types/project";

// Terminal commands
export const ptySpawn = (params: {
  id: string;
  cwd: string;
  command?: string;
  label: string;
  color: string;
  projectId?: string;
}) =>
  invoke<TerminalInfo>("pty_spawn", {
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

export const getTerminals = () => invoke<TerminalInfo[]>("get_terminals");

// Session commands
export const getSessions = (limit?: number, projectPath?: string) =>
  invoke<Session[]>("get_sessions", {
    limit: limit ?? null,
    projectPath: projectPath ?? null,
  });

export const getProjectPaths = () => invoke<string[]>("get_project_paths");

// Project commands
export const getProjects = () => invoke<Project[]>("get_projects");

export const addProject = (project: Project) =>
  invoke<Project[]>("add_project", { ...project });

export const updateProject = (project: Project) =>
  invoke<Project[]>("update_project", { ...project });

export const deleteProject = (id: string) =>
  invoke<Project[]>("delete_project", { id });

// System commands
export interface BrowseResult {
  current_path: string;
  parent_path: string | null;
  directories: { name: string; path: string; is_dir: boolean }[];
}

export const browseDirectory = (path: string) =>
  invoke<BrowseResult>("browse_directory", { path });

export const getHomeDir = () => invoke<string>("get_home_dir");

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
