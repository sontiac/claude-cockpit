import { Play, MessageSquare, Wrench, GitBranch } from "lucide-react";
import { formatRelativeTime } from "../../lib/constants";
import type { Session } from "../../types/session";

interface SessionCardProps {
  session: Session;
  onResume: (sessionId: string, cwd: string) => void;
}

function formatModel(model: string | null): string {
  if (!model) return "";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

export function SessionCard({ session, onResume }: SessionCardProps) {
  const modelLabel = formatModel(session.model);

  return (
    <button
      onClick={() => onResume(session.session_id, session.cwd)}
      className="w-full text-left px-3 py-3 rounded-lg hover:bg-white/5 group transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Slug / session name */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {session.slug || session.session_id.slice(0, 8)}
            </span>
            <span className="text-xs text-foreground-muted flex-shrink-0">
              {formatRelativeTime(session.last_message)}
            </span>
          </div>

          {/* Summary */}
          {session.summary && (
            <p className="text-xs text-foreground-muted mt-1 line-clamp-2 leading-relaxed">
              {session.summary}
            </p>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-foreground-muted">
            <span className="flex items-center gap-1">
              <MessageSquare size={11} />
              {session.message_count}
            </span>
            {session.tool_call_count > 0 && (
              <span className="flex items-center gap-1">
                <Wrench size={11} />
                {session.tool_call_count}
              </span>
            )}
            {session.git_branch && (
              <span className="flex items-center gap-1 truncate max-w-[120px]">
                <GitBranch size={11} />
                {session.git_branch}
              </span>
            )}
            {modelLabel && (
              <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] font-medium">
                {modelLabel}
              </span>
            )}
          </div>
        </div>

        {/* Resume button */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1">
          <div className="p-1.5 rounded-lg bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30">
            <Play size={13} />
          </div>
        </div>
      </div>
    </button>
  );
}
