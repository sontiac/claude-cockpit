import { useState, useCallback, useEffect } from "react";
import {
  ptySpawn,
  ptyKill,
  getWorkspace,
  saveWorkspace,
} from "../lib/ipc";
import { generateId } from "../lib/utils";
import { DEFAULT_COMMAND, PROJECT_COLORS } from "../lib/constants";
import { restoreCommand } from "../lib/restore";
import { playSound } from "../lib/sounds";
import type {
  TerminalInfo,
  TerminalStatus,
  PersistedTerminal,
} from "../types/terminal";

function toPersisted(t: TerminalInfo): PersistedTerminal {
  return {
    cwd: t.cwd,
    label: t.label,
    color: t.color,
    command: t.command,
    project_id: t.project_id,
  };
}

export function useTerminals() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Terminals open in the previous session, awaiting a restore decision.
  const [restorable, setRestorable] = useState<PersistedTerminal[]>([]);
  // Persistence stays disarmed until the restore decision is made, so the empty
  // initial state can't overwrite the saved workspace before we read it.
  const [persistArmed, setPersistArmed] = useState(false);

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

      // Give every fresh Claude session an explicit id so it can later be
      // restored exactly (multiple sessions can share one folder, where
      // --continue would be ambiguous). Skip if the command already selects a
      // session (--resume / -r / --session-id).
      if (
        command &&
        /(^|[/\s])claude(\s|$)/.test(command) &&
        !/--resume\b|--session-id\b|(?:^|\s)-r\b/.test(command)
      ) {
        command = `${command} --session-id ${generateId()}`;
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

  // Load the previous session's open terminals once on startup. If there's
  // nothing to restore, arm persistence immediately; otherwise wait for the
  // user's restore decision.
  useEffect(() => {
    getWorkspace()
      .then((saved) => {
        if (saved.length > 0) setRestorable(saved);
        else setPersistArmed(true);
      })
      .catch((error) => {
        console.error("Failed to load workspace:", error);
        setPersistArmed(true);
      });
  }, []);

  // Persist the set of open terminals whenever it changes (once armed). Status
  // is intentionally excluded from the snapshot, so transient status flips that
  // mutate `terminals` simply re-write the same persisted shape.
  useEffect(() => {
    if (!persistArmed) return;
    saveWorkspace(terminals.map(toPersisted)).catch((error) =>
      console.error("Failed to persist workspace:", error)
    );
  }, [terminals, persistArmed]);

  const restore = useCallback(async () => {
    const items = restorable;
    setRestorable([]);
    for (const t of items) {
      try {
        await spawn({
          cwd: t.cwd,
          command: restoreCommand(t.command),
          label: t.label,
          color: t.color,
          projectId: t.project_id ?? undefined,
        });
      } catch (error) {
        console.error("Failed to restore terminal:", t.label, error);
      }
    }
    setPersistArmed(true);
  }, [restorable, spawn]);

  const dismissRestore = useCallback(() => {
    setRestorable([]);
    setPersistArmed(true);
  }, []);

  return {
    terminals,
    activeId,
    setActiveId,
    spawn,
    kill,
    rename,
    updateStatus,
    restorable,
    restore,
    dismissRestore,
  };
}
