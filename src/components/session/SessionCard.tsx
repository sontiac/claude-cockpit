import { Play } from "lucide-react";
import { formatRelativeTime } from "../../lib/constants";
import { shortenPath } from "../../lib/utils";
import type { Session } from "../../types/session";

interface SessionCardProps {
  session: Session;
  onResume: (sessionId: string, cwd: string) => void;
}

export function SessionCard({ session, onResume }: SessionCardProps) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-white/5 group">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">
          {session.summary || "No summary"}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="path-text truncate">
            {shortenPath(session.cwd)}
          </span>
          <span className="text-xs text-foreground-muted">
            {formatRelativeTime(session.last_message)}
          </span>
          <span className="text-xs text-foreground-muted">
            {session.message_count} msg{session.message_count !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <button
        onClick={() => onResume(session.session_id, session.cwd)}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30"
        title="Resume session"
      >
        <Play size={13} />
      </button>
    </div>
  );
}
