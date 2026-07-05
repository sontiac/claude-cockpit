import { useState, useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getWindowNotes,
  saveWindowNotes,
  removeNoteContent,
  removeWindowNotes,
  clearNotes,
} from "../lib/ipc";
import { generateId } from "../lib/utils";
import { PROJECT_COLORS } from "../lib/constants";
import type { CanvasPane, CanvasPaneKind, PersistedPane } from "../types/pane";

const WINDOW_LABEL = getCurrentWindow().label;

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;

const KIND_LABELS: Record<CanvasPaneKind, string> = {
  note: "Note",
  mdviewer: "Plan",
  pomodoro: "Pomodoro",
};

function toPersisted(p: CanvasPane): PersistedPane {
  return {
    id: p.id,
    label: p.label,
    color: p.color,
    workspace_id: p.workspaceId,
    kind: p.kind,
    path: p.kind === "mdviewer" ? p.path : null,
    work_minutes: p.kind === "pomodoro" ? p.workMinutes : null,
    break_minutes: p.kind === "pomodoro" ? p.breakMinutes : null,
  };
}

function fromPersisted(p: PersistedPane): CanvasPane {
  const base = {
    id: p.id,
    label: p.label,
    color: p.color,
    workspaceId: p.workspace_id ?? "",
  };
  switch (p.kind) {
    case "mdviewer":
      return { ...base, kind: "mdviewer", path: p.path ?? null };
    case "pomodoro":
      return {
        ...base,
        kind: "pomodoro",
        workMinutes: p.work_minutes ?? DEFAULT_WORK_MINUTES,
        breakMinutes: p.break_minutes ?? DEFAULT_BREAK_MINUTES,
      };
    default:
      // Files written before panes had kinds are notes; unknown kinds from a
      // newer version degrade to notes rather than being dropped.
      return { ...base, kind: "note" };
  }
}

/**
 * Owns the non-terminal canvas panes (notes, markdown viewers, pomodoros) for
 * this window and persists them to their own per-window file. Deliberately
 * independent of `useTerminals` / `WindowState` / the recovery modal: panes are
 * durable, so they load immediately on launch and are never gated behind a
 * Recover/Discard choice. Note text content lives in separate per-id files.
 */
export function usePanes() {
  const [panes, setPanes] = useState<CanvasPane[]>([]);
  // Disarm persistence until the initial load completes, so the empty initial
  // state can't overwrite the saved file.
  const [loaded, setLoaded] = useState(false);
  // Set while this window is being closed/forgotten, so the persist effect
  // doesn't re-create the pane file we just removed.
  const closingRef = useRef(false);

  const addPane = useCallback(
    (kind: CanvasPaneKind, workspaceId: string): CanvasPane => {
      const base = {
        id: generateId(),
        label: KIND_LABELS[kind],
        color: PROJECT_COLORS[Math.floor(Date.now()) % PROJECT_COLORS.length],
        workspaceId,
      };
      const pane: CanvasPane =
        kind === "mdviewer"
          ? { ...base, kind, path: null }
          : kind === "pomodoro"
            ? {
                ...base,
                kind,
                workMinutes: DEFAULT_WORK_MINUTES,
                breakMinutes: DEFAULT_BREAK_MINUTES,
              }
            : { ...base, kind: "note" };
      setPanes((prev) => [...prev, pane]);
      return pane;
    },
    []
  );

  const renamePane = useCallback((id: string, label: string) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, label } : p)));
  }, []);

  const movePane = useCallback((id: string, workspaceId: string) => {
    setPanes((prev) => prev.map((p) => (p.id === id ? { ...p, workspaceId } : p)));
  }, []);

  const removePane = useCallback((id: string) => {
    setPanes((prev) => prev.filter((p) => p.id !== id));
    // Only notes have content files, but removal of a missing file is a no-op
    // backend-side, so this stays unconditional and simple.
    removeNoteContent(id).catch((e) =>
      console.error("Failed to remove note content:", e)
    );
  }, []);

  const setPanePath = useCallback((id: string, path: string | null) => {
    setPanes((prev) =>
      prev.map((p) => (p.id === id && p.kind === "mdviewer" ? { ...p, path } : p))
    );
  }, []);

  const setPomodoroDurations = useCallback(
    (id: string, workMinutes: number, breakMinutes: number) => {
      setPanes((prev) =>
        prev.map((p) =>
          p.id === id && p.kind === "pomodoro" ? { ...p, workMinutes, breakMinutes } : p
        )
      );
    },
    []
  );

  const reassignPanes = useCallback(
    (fromWorkspaceId: string, toWorkspaceId: string) => {
      setPanes((prev) =>
        prev.map((p) =>
          p.workspaceId === fromWorkspaceId ? { ...p, workspaceId: toWorkspaceId } : p
        )
      );
    },
    []
  );

  const discardPanes = useCallback(async () => {
    setPanes([]);
    await clearNotes().catch((e) => console.error("Failed to clear panes:", e));
  }, []);

  // Forget this window's panes when the window is deliberately closed: delete
  // every note's content file, then remove this window's pane-list file. Guards
  // persistence first so the subsequent empty state can't re-save the file.
  const forgetWindowPanes = useCallback(async () => {
    closingRef.current = true;
    await Promise.all(
      panes
        .filter((p) => p.kind === "note")
        .map((p) =>
          removeNoteContent(p.id).catch((e) =>
            console.error("Failed to remove note content:", e)
          )
        )
    );
    await removeWindowNotes(WINDOW_LABEL).catch((e) =>
      console.error("Failed to remove window panes:", e)
    );
    setPanes([]);
  }, [panes]);

  // Load this window's saved panes on mount, then arm persistence.
  useEffect(() => {
    (async () => {
      try {
        const persisted = await getWindowNotes(WINDOW_LABEL);
        setPanes(persisted.map(fromPersisted));
      } catch (error) {
        console.error("Failed to load panes:", error);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Persist whenever panes change, once armed (and not while closing).
  useEffect(() => {
    if (!loaded || closingRef.current) return;
    saveWindowNotes(WINDOW_LABEL, panes.map(toPersisted)).catch((e) =>
      console.error("Failed to persist panes:", e)
    );
  }, [panes, loaded]);

  return {
    panes,
    addPane,
    renamePane,
    movePane,
    removePane,
    reassignPanes,
    discardPanes,
    forgetWindowPanes,
    setPanePath,
    setPomodoroDurations,
  };
}
