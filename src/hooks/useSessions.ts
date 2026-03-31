import { useState, useCallback, useEffect, useRef } from "react";
import { getSessions } from "../lib/ipc";
import type { Session } from "../types/session";

interface UseSessionsOptions {
  /** Project paths from the user's saved projects — sessions are scoped to these */
  projectPaths: string[];
}

export function useSessions({ projectPaths }: UseSessionsOptions) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filterPath, setFilterPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRequest = useRef(0);

  // When project paths change and we don't have a filter, auto-select the first
  useEffect(() => {
    if (filterPath === null && projectPaths.length > 0) {
      setFilterPath(projectPaths[0]);
    }
  }, [projectPaths, filterPath]);

  const refresh = useCallback(async () => {
    const path = filterPath;
    if (!path) {
      setSessions([]);
      return;
    }

    const requestId = ++activeRequest.current;
    setLoading(true);

    try {
      const data = await getSessions(50, path);
      // Only apply result if this is still the latest request
      if (requestId === activeRequest.current) {
        setSessions(data);
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      if (requestId === activeRequest.current) {
        setLoading(false);
      }
    }
  }, [filterPath]);

  useEffect(() => {
    if (filterPath) {
      refresh();
    }
  }, [filterPath, refresh]);

  return {
    sessions,
    filterPath,
    setFilterPath,
    loading,
    refresh,
  };
}
