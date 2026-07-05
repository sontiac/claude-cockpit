import { useState, useEffect } from "react";
import { readTextFile, statFile } from "../lib/ipc";

const POLL_MS = 2000;

export interface MarkdownFileState {
  content: string | null;
  error: string | null;
}

/**
 * Loads a text file and keeps it fresh: polls the file's mtime every POLL_MS
 * and re-reads only when it changed — so a plan file Claude rewrites shows up
 * here on its own. A failing poll (file briefly missing mid-rewrite) keeps the
 * last content, shows the error, and keeps polling so it recovers by itself.
 */
export function useMarkdownFile(path: string | null): MarkdownFileState {
  const [state, setState] = useState<MarkdownFileState>({
    content: null,
    error: null,
  });

  useEffect(() => {
    setState({ content: null, error: null });
    if (!path) return;

    let cancelled = false;
    let mtime = 0;

    const load = async () => {
      try {
        const file = await readTextFile(path);
        if (cancelled) return;
        mtime = file.mtime_ms;
        setState({ content: file.content, error: null });
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({ content: prev.content, error: String(e) }));
      }
    };

    load();
    const timer = setInterval(async () => {
      try {
        const current = await statFile(path);
        if (cancelled || current === mtime) return;
        await load();
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({ content: prev.content, error: String(e) }));
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path]);

  return state;
}
