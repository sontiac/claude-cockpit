import { useState, useCallback } from "react";
import { ptySpawn, ptyKill } from "../lib/ipc";
import { generateId } from "../lib/utils";
import { DEFAULT_COMMAND, PROJECT_COLORS } from "../lib/constants";
import { playSound } from "../lib/sounds";
import type { TerminalInfo, TerminalStatus } from "../types/terminal";

export function useTerminals() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const spawn = useCallback(
    async (options?: {
      cwd?: string;
      command?: string;
      label?: string;
      color?: string;
      projectId?: string;
      resumeSessionId?: string;
    }) => {
      const id = generateId();
      const cwd = options?.cwd || "/";
      const label = options?.label || `Terminal ${terminals.length + 1}`;
      const color =
        options?.color || PROJECT_COLORS[terminals.length % PROJECT_COLORS.length];

      let command = options?.command ?? null;
      if (options?.resumeSessionId) {
        command = `${DEFAULT_COMMAND} --resume ${options.resumeSessionId}`;
      }

      try {
        const info = await ptySpawn({
          id,
          cwd,
          command: command ?? undefined,
          label,
          color,
          projectId: options?.projectId,
        });

        setTerminals((prev) => [...prev, info]);
        setActiveId(id);
        playSound("launch");
        return info;
      } catch (error) {
        console.error("Failed to spawn terminal:", error);
        throw error;
      }
    },
    [terminals.length]
  );

  const kill = useCallback(
    async (id: string) => {
      try {
        await ptyKill(id);
      } catch {
        // Terminal may already be dead
      }
      setTerminals((prev) => prev.filter((t) => t.id !== id));
      setActiveId((prev) => {
        if (prev === id) {
          const remaining = terminals.filter((t) => t.id !== id);
          return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        }
        return prev;
      });
    },
    [terminals]
  );

  const rename = useCallback((id: string, label: string) => {
    setTerminals((prev) =>
      prev.map((t) => (t.id === id ? { ...t, label } : t))
    );
  }, []);

  const updateStatus = useCallback((id: string, status: TerminalStatus) => {
    setTerminals((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status } : t))
    );
  }, []);

  return {
    terminals,
    activeId,
    setActiveId,
    spawn,
    kill,
    rename,
    updateStatus,
  };
}
