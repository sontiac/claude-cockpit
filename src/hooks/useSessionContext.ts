import { useEffect, useState } from "react";
import { getSessionContext } from "../lib/ipc";
import { sessionIdFromCommand } from "../lib/restore";
import type { SessionContext } from "../types/session";
import type { TerminalStatus } from "../types/terminal";

// How often to re-read a live session's context usage from its transcript. The
// read is a bounded tail of one file, so this is cheap; a few seconds keeps the
// badge feeling live without hammering the disk.
const CONTEXT_POLL_MS = 4000;

/**
 * Tracks the context-window usage of the Claude session a terminal is bound to.
 *
 * The session id is recovered from the terminal's spawn command (every Claude
 * terminal cockpit launches carries `--session-id` or `--resume`), and the
 * transcript is located from that id + the terminal's cwd. Returns `null` for
 * non-Claude terminals and for sessions that haven't written a turn yet.
 *
 * `status` is only used as a refresh nudge: when it changes (e.g. Claude goes
 * from responding → idle, meaning a turn just landed) we re-read immediately
 * instead of waiting for the next poll tick.
 */
export function useSessionContext(
  command: string,
  cwd: string,
  status: TerminalStatus
): SessionContext | null {
  const [context, setContext] = useState<SessionContext | null>(null);
  const sessionId = sessionIdFromCommand(command);

  useEffect(() => {
    if (!sessionId) {
      setContext(null);
      return;
    }

    let cancelled = false;
    const read = async () => {
      try {
        const result = await getSessionContext(sessionId, cwd);
        if (!cancelled) setContext(result);
      } catch (err) {
        if (!cancelled) console.error("Failed to read session context:", err);
      }
    };

    read();
    const interval = setInterval(read, CONTEXT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // `status` is included so a status change triggers an immediate re-read.
  }, [sessionId, cwd, status]);

  return context;
}
