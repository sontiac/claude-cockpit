import { useState, useEffect, useRef, useCallback } from "react";
import { getNoteContent, saveNoteContent } from "../lib/ipc";

const SAVE_DEBOUNCE_MS = 500;

/**
 * Loads a note's ProseMirror JSON on mount and saves edits back, debounced.
 * Any pending save is flushed on unmount so no keystrokes are lost. Kept separate
 * from the editor component so the debounce/flush logic is testable in isolation.
 */
export function useNoteContent(id: string) {
  const [loaded, setLoaded] = useState(false);
  const [initialContent, setInitialContent] = useState<unknown | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<unknown | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (pendingRef.current !== null) {
      const content = pendingRef.current;
      pendingRef.current = null;
      saveNoteContent(id, content).catch((e) =>
        console.error("Failed to save note content:", e)
      );
    }
  }, [id]);

  const onChange = useCallback(
    (content: unknown) => {
      pendingRef.current = content;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  useEffect(() => {
    (async () => {
      try {
        const content = await getNoteContent(id);
        setInitialContent(content ?? null);
      } catch (error) {
        console.error("Failed to load note content:", error);
      } finally {
        setLoaded(true);
      }
    })();
    // Flush any pending save when the pane unmounts.
    return () => flush();
  }, [id, flush]);

  return { loaded, initialContent, onChange };
}
