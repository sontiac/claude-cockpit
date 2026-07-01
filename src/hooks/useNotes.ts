import { useState, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getWindowNotes,
  saveWindowNotes,
  removeNoteContent,
  clearNotes,
} from "../lib/ipc";
import { generateId } from "../lib/utils";
import { PROJECT_COLORS } from "../lib/constants";
import type { NotePane, PersistedNote } from "../types/pane";

const WINDOW_LABEL = getCurrentWindow().label;

function toPersisted(n: NotePane): PersistedNote {
  return {
    id: n.id,
    label: n.label,
    color: n.color,
    workspace_id: n.workspaceId,
  };
}

function fromPersisted(n: PersistedNote): NotePane {
  return {
    id: n.id,
    label: n.label,
    color: n.color,
    workspaceId: n.workspace_id ?? "",
  };
}

/**
 * Owns the note panes for this window and persists them to their own per-window
 * file. Deliberately independent of `useTerminals` / `WindowState` / the recovery
 * modal: notes are durable documents, so they load immediately on launch and are
 * never gated behind a Recover/Discard choice.
 */
export function useNotes() {
  const [notes, setNotes] = useState<NotePane[]>([]);
  // Disarm persistence until the initial load completes, so the empty initial
  // state can't overwrite the saved file.
  const [loaded, setLoaded] = useState(false);

  const addNote = useCallback((workspaceId: string): NotePane => {
    const note: NotePane = {
      id: generateId(),
      label: "Note",
      color: PROJECT_COLORS[Math.floor(Date.now()) % PROJECT_COLORS.length],
      workspaceId,
    };
    setNotes((prev) => [...prev, note]);
    return note;
  }, []);

  const renameNote = useCallback((id: string, label: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, label } : n)));
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    removeNoteContent(id).catch((e) =>
      console.error("Failed to remove note content:", e)
    );
  }, []);

  const reassignNotes = useCallback(
    (fromWorkspaceId: string, toWorkspaceId: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.workspaceId === fromWorkspaceId
            ? { ...n, workspaceId: toWorkspaceId }
            : n
        )
      );
    },
    []
  );

  const discardNotes = useCallback(async () => {
    setNotes([]);
    await clearNotes().catch((e) =>
      console.error("Failed to clear notes:", e)
    );
  }, []);

  // Load this window's saved notes on mount, then arm persistence.
  useEffect(() => {
    (async () => {
      try {
        const persisted = await getWindowNotes(WINDOW_LABEL);
        setNotes(persisted.map(fromPersisted));
      } catch (error) {
        console.error("Failed to load notes:", error);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Persist whenever notes change, once armed.
  useEffect(() => {
    if (!loaded) return;
    saveWindowNotes(WINDOW_LABEL, notes.map(toPersisted)).catch((e) =>
      console.error("Failed to persist notes:", e)
    );
  }, [notes, loaded]);

  return { notes, addNote, renameNote, removeNote, reassignNotes, discardNotes };
}
