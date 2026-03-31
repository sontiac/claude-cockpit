import { useState, useCallback, useEffect } from "react";
import { getSessions, getProjectPaths } from "../lib/ipc";
import type { Session } from "../types/session";

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projectPaths, setProjectPaths] = useState<string[]>([]);
  const [filterPath, setFilterPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionsData, pathsData] = await Promise.all([
        getSessions(50, filterPath ?? undefined),
        getProjectPaths(),
      ]);
      setSessions(sessionsData);
      setProjectPaths(pathsData);
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setLoading(false);
    }
  }, [filterPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    sessions,
    projectPaths,
    filterPath,
    setFilterPath,
    loading,
    refresh,
  };
}
