import { useState, useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ptySpawn,
  ptyKill,
  getWindowState,
  saveWindowState,
  listSessionLabels,
  clearSession,
  openWindow,
} from "../lib/ipc";
import { generateId } from "../lib/utils";
import { DEFAULT_COMMAND, PROJECT_COLORS } from "../lib/constants";
import { restoreCommand } from "../lib/restore";
import { playSound } from "../lib/sounds";
import type {
  TerminalInfo,
  TerminalStatus,
  PersistedTerminal,
  Workspace,
  Geometry,
} from "../types/terminal";

const WINDOW_LABEL = getCurrentWindow().label;
const IS_MAIN_WINDOW = WINDOW_LABEL === "main";

function toPersisted(t: TerminalInfo): PersistedTerminal {
  return {
    cwd: t.cwd,
    label: t.label,
    color: t.color,
    command: t.command,
    project_id: t.project_id,
    workspace_id: t.workspaceId,
  };
}

function defaultWorkspace(): Workspace {
  return { id: generateId(), name: "Workspace 1" };
}

async function currentGeometry(): Promise<Geometry | null> {
  try {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const size = await win.innerSize();
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

/** What the main window's recovery prompt needs to know. */
interface RestorePrompt {
  terminalCount: number;
  windowCount: number;
}

interface PendingSession {
  myTerminals: PersistedTerminal[];
  secondaries: { label: string; geometry: Geometry | null }[];
  terminalCount: number;
  windowCount: number;
}

export function useTerminals() {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => [
    defaultWorkspace(),
  ]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(
    () => workspaces[0].id
  );

  // Persistence stays disarmed until the restore decision is made (main window)
  // or the initial state has loaded (secondary windows), so the empty initial
  // state can't overwrite the saved session.
  const [persistArmed, setPersistArmed] = useState(false);
  // Bumped when the window is moved/resized, to re-persist fresh geometry.
  const [geometryVersion, setGeometryVersion] = useState(0);

  // Main-window recovery prompt (null = nothing to recover / already decided).
  const [pending, setPending] = useState<PendingSession | null>(null);
  const pendingRef = useRef<PendingSession | null>(null);
  pendingRef.current = pending;

  const spawn = useCallback(
    async (options?: {
      cwd?: string;
      command?: string;
      label?: string;
      color?: string;
      projectId?: string;
      resumeSessionId?: string;
      workspaceId?: string;
    }) => {
      const id = generateId();
      const cwd = options?.cwd || "/";
      const label = options?.label || `Terminal ${terminals.length + 1}`;
      const color =
        options?.color || PROJECT_COLORS[terminals.length % PROJECT_COLORS.length];
      const workspaceId = options?.workspaceId ?? activeWorkspaceId;

      let command = options?.command ?? null;
      if (options?.resumeSessionId) {
        command = `${DEFAULT_COMMAND} --resume ${options.resumeSessionId}`;
      }

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
        const terminal: TerminalInfo = { ...info, workspaceId };
        setTerminals((prev) => [...prev, terminal]);
        setActiveId(id);
        playSound("launch");
        return terminal;
      } catch (error) {
        console.error("Failed to spawn terminal:", error);
        throw error;
      }
    },
    [terminals.length, activeWorkspaceId]
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

  // --- Workspaces ---------------------------------------------------------
  const switchWorkspace = useCallback(
    (id: string) => {
      setActiveWorkspaceId(id);
      setActiveId(() => {
        const inWs = terminals.filter((t) => t.workspaceId === id);
        return inWs.length > 0 ? inWs[inWs.length - 1].id : null;
      });
    },
    [terminals]
  );

  const createWorkspace = useCallback(() => {
    const ws: Workspace = {
      id: generateId(),
      name: `Workspace ${workspaces.length + 1}`,
    };
    setWorkspaces((prev) => [...prev, ws]);
    setActiveWorkspaceId(ws.id);
    setActiveId(null);
    return ws;
  }, [workspaces.length]);

  const renameWorkspace = useCallback((id: string, name: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, name } : w))
    );
  }, []);

  const deleteWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      if (prev.length <= 1) return prev;
      const remaining = prev.filter((w) => w.id !== id);
      const fallback = remaining[0].id;
      setTerminals((ts) =>
        ts.map((t) =>
          t.workspaceId === id ? { ...t, workspaceId: fallback } : t
        )
      );
      setActiveWorkspaceId((cur) => (cur === id ? fallback : cur));
      return remaining;
    });
  }, []);

  // Spawn a set of persisted terminals back into their workspaces.
  const restoreTerminals = useCallback(
    async (items: PersistedTerminal[], fallbackWs: string) => {
      for (const t of items) {
        try {
          await spawn({
            cwd: t.cwd,
            command: restoreCommand(t.command),
            label: t.label,
            color: t.color,
            projectId: t.project_id ?? undefined,
            workspaceId: t.workspace_id ?? fallbackWs,
          });
        } catch (error) {
          console.error("Failed to restore terminal:", t.label, error);
        }
      }
    },
    [spawn]
  );

  // --- Startup: load this window's saved state ----------------------------
  useEffect(() => {
    (async () => {
      let state;
      try {
        state = await getWindowState(WINDOW_LABEL);
      } catch (error) {
        console.error("Failed to load window state:", error);
        setPersistArmed(true);
        return;
      }

      const loadedWs =
        state.workspaces.length > 0 ? state.workspaces : [defaultWorkspace()];
      setWorkspaces(loadedWs);
      const active =
        state.active_workspace_id &&
        loadedWs.some((w) => w.id === state.active_workspace_id)
          ? state.active_workspace_id
          : loadedWs[0].id;
      setActiveWorkspaceId(active);

      const myTerminals = state.terminals.map((t) => ({
        ...t,
        workspace_id: t.workspace_id ?? active,
      }));

      if (IS_MAIN_WINDOW) {
        // Gather the whole session (this window + any secondary windows) so the
        // recovery prompt can summarise it and recreate the windows on Recover.
        let labels: string[] = [];
        try {
          labels = await listSessionLabels();
        } catch {
          /* no session dir yet */
        }
        const secLabels = labels.filter((l) => l !== "main");
        const secStates = await Promise.all(
          secLabels.map(async (l) => {
            const s = await getWindowState(l).catch(() => null);
            return s ? { label: l, geometry: s.geometry, terminals: s.terminals } : null;
          })
        );
        const secondaries = secStates.filter(
          (s): s is NonNullable<typeof s> => s !== null
        );
        const secTermCount = secondaries.reduce(
          (n, s) => n + s.terminals.length,
          0
        );
        const terminalCount = myTerminals.length + secTermCount;
        const windowCount = 1 + secondaries.length;

        if (terminalCount > 0 || secondaries.length > 0) {
          setPending({
            myTerminals,
            secondaries: secondaries.map((s) => ({
              label: s.label,
              geometry: s.geometry,
            })),
            terminalCount,
            windowCount,
          });
        } else {
          setPersistArmed(true);
        }
      } else {
        // Secondary window: it was recreated as part of a confirmed recovery (or
        // freshly opened, in which case there's nothing to restore). Restore its
        // terminals silently — the recover decision was already made in main.
        await restoreTerminals(myTerminals, active);
        setPersistArmed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recover the full session: restore this window's terminals and recreate the
  // secondary windows (each self-restores from its own saved state).
  const recover = useCallback(async () => {
    const p = pendingRef.current;
    setPending(null);
    if (p) {
      await restoreTerminals(p.myTerminals, activeWorkspaceId);
      for (const s of p.secondaries) {
        await openWindow(s.label, s.geometry ?? undefined).catch((e) =>
          console.error("Failed to reopen window:", e)
        );
      }
    }
    setPersistArmed(true);
  }, [restoreTerminals, activeWorkspaceId]);

  // Discard the whole saved session and start clean.
  const discard = useCallback(async () => {
    setPending(null);
    await clearSession().catch((e) =>
      console.error("Failed to clear session:", e)
    );
    const ws = defaultWorkspace();
    setWorkspaces([ws]);
    setActiveWorkspaceId(ws.id);
    setActiveId(null);
    setPersistArmed(true);
  }, []);

  // --- Persist this window's state (all windows, once armed) --------------
  useEffect(() => {
    if (!persistArmed) return;
    let cancelled = false;
    currentGeometry().then((geometry) => {
      if (cancelled) return;
      saveWindowState(WINDOW_LABEL, {
        workspaces,
        terminals: terminals.map(toPersisted),
        active_workspace_id: activeWorkspaceId,
        geometry,
      }).catch((error) => console.error("Failed to persist window:", error));
    });
    return () => {
      cancelled = true;
    };
  }, [terminals, workspaces, activeWorkspaceId, persistArmed, geometryVersion]);

  // Re-persist geometry when the window is moved or resized (debounced).
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unMoved: (() => void) | undefined;
    let unResized: (() => void) | undefined;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setGeometryVersion((v) => v + 1), 400);
    };
    win.onMoved(bump).then((u) => (unMoved = u));
    win.onResized(bump).then((u) => (unResized = u));
    return () => {
      if (timer) clearTimeout(timer);
      unMoved?.();
      unResized?.();
    };
  }, []);

  const restorePrompt: RestorePrompt | null = pending
    ? { terminalCount: pending.terminalCount, windowCount: pending.windowCount }
    : null;

  return {
    terminals,
    activeId,
    setActiveId,
    spawn,
    kill,
    rename,
    updateStatus,
    restorePrompt,
    recover,
    discard,
    workspaces,
    activeWorkspaceId,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  };
}
