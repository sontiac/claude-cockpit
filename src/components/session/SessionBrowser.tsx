import { RefreshCw } from "lucide-react";
import { SessionCard } from "./SessionCard";
import { SessionFilter } from "./SessionFilter";
import type { Session } from "../../types/session";

interface SessionBrowserProps {
  sessions: Session[];
  projectPaths: string[];
  filterPath: string | null;
  onFilterChange: (path: string | null) => void;
  onResume: (sessionId: string, cwd: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function SessionBrowser({
  sessions,
  projectPaths,
  filterPath,
  onFilterChange,
  onResume,
  onRefresh,
  loading,
}: SessionBrowserProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2">
        <SessionFilter
          paths={projectPaths}
          value={filterPath}
          onChange={onFilterChange}
        />
        <button
          onClick={onRefresh}
          className="p-1.5 rounded-lg hover:bg-white/10 text-foreground-muted hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1">
        {sessions.length === 0 ? (
          <p className="text-sm text-foreground-muted text-center py-8">
            No sessions found
          </p>
        ) : (
          sessions.map((session) => (
            <SessionCard
              key={session.session_id}
              session={session}
              onResume={onResume}
            />
          ))
        )}
      </div>
    </div>
  );
}
