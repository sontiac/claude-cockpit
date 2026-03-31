import { useState, useCallback, useEffect } from "react";
import {
  getProjects,
  addProject as addProjectIpc,
  updateProject as updateProjectIpc,
  deleteProject as deleteProjectIpc,
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

  return { projects, add, update, remove, refresh };
}
