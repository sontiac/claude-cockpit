import { useState, useCallback, useEffect } from "react";
import {
  getProjects,
  addProject as addProjectIpc,
  updateProject as updateProjectIpc,
  deleteProject as deleteProjectIpc,
  reorderProjects as reorderProjectsIpc,
} from "../lib/ipc";
import type { Project } from "../types/project";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async (project: Project) => {
    const updated = await addProjectIpc(project);
    setProjects(updated);
  }, []);

  const update = useCallback(async (project: Project) => {
    const updated = await updateProjectIpc(project);
    setProjects(updated);
  }, []);

  const remove = useCallback(async (id: string) => {
    const updated = await deleteProjectIpc(id);
    setProjects(updated);
  }, []);

  // Optimistically apply the new order so the drag feels instant, then persist.
  // The backend echoes the canonical order back, which we adopt as the source of
  // truth (and which corrects the optimistic state if a concurrent change raced).
  const reorder = useCallback(async (orderedIds: string[]) => {
    setProjects((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      const next = orderedIds
        .map((id) => byId.get(id))
        .filter((p): p is Project => p !== undefined);
      // Keep any project not present in orderedIds (shouldn't happen, but is
      // cheap insurance against dropping a row).
      for (const p of prev) {
        if (!orderedIds.includes(p.id)) next.push(p);
      }
      return next;
    });
    try {
      const updated = await reorderProjectsIpc(orderedIds);
      setProjects(updated);
    } catch (error) {
      console.error("Failed to reorder projects:", error);
      refresh();
    }
  }, [refresh]);

  return { projects, add, update, remove, reorder, refresh };
}
