import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Terminal,
  ChevronDown,
  ChevronRight,
  Play,
  MessageSquare,
  Wrench,
} from "lucide-react";
import type { Project } from "../../types/project";
import type { Session } from "../../types/session";
import { formatRelativeTime } from "../../lib/constants";
import { getSessions } from "../../lib/ipc";

interface SidebarProps {
  projects: Project[];
  onLaunchProject: (project: Project) => void;
  onAddProject: () => void;
  onNewTerminal: () => void;
  onResumeSession: (sessionId: string, cwd: string, label: string) => void;
}

function formatModel(model: string | null): string {
  if (!model) return "";
  if (model.includes("opus")) return "Op";
  if (model.includes("sonnet")) return "So";
  if (model.includes("haiku")) return "Ha";
  return "";
}

function getDisplayTitle(session: Session): string {
  if (session.custom_title) return session.custom_title;
  if (session.first_user_message) return session.first_user_message;
  if (session.slug) return session.slug;
  return session.session_id.slice(0, 8);
}

function ProjectSection({
  project,
  onLaunch,
  onResume,
}: {
  project: Project;
  onLaunch: () => void;
  onResume: (sessionId: string, cwd: string, label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadSessions = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const data = await getSessions(20, project.path);
      setSessions(data);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load sessions for", project.name, err);
    } finally {
      setLoading(false);
    }
  }, [project.path, loaded, project.name]);

  useEffect(() => {
    if (expanded && !loaded) {
      loadSessions();
    }
  }, [expanded, loaded, loadSessions]);

  return (
    <div>
      {/* Project header */}
      <div className="flex items-center gap-1 group">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 px-2 py-2 rounded-lg text-left hover:bg-white/5"
        >
          {expanded ? (
            <ChevronDown size={13} className="text-foreground-muted flex-shrink-0" />
          ) : (
            <ChevronRight size={13} className="text-foreground-muted flex-shrink-0" />
          )}
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: project.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-foreground truncate">
              {project.name}
            </div>
          </div>
        </button>
        <button
          onClick={onLaunch}
          className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent-cyan/20 text-foreground-muted hover:text-accent-cyan flex-shrink-0 mr-1"
          title={`Launch ${project.terminals} terminal${project.terminals > 1 ? "s" : ""}`}
        >
          <Play size={12} />
        </button>
      </div>

      {/* Sessions dropdown */}
      {expanded && (
        <div className="ml-5 border-l border-card-border pl-2 mb-1">
          {loading ? (
            <div className="px-2 py-2 text-xs text-foreground-muted">
              Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-2 text-xs text-foreground-muted">
              No sessions yet
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.session_id}
                onClick={() => {
                  const sessionTitle = getDisplayTitle(session);
                  const label = session.custom_title
                    ? `${project.name}: ${session.custom_title}`
                    : `${project.name}: ${sessionTitle.slice(0, 40)}`;
                  onResume(session.session_id, session.cwd, label);
                }}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-white/5 group/session"
              >
                <div className="text-xs text-foreground truncate leading-relaxed">
                  {getDisplayTitle(session)}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-foreground-muted">
                  <span>{formatRelativeTime(session.last_message)}</span>
                  <span className="flex items-center gap-0.5">
                    <MessageSquare size={9} />
                    {session.message_count}
                  </span>
                  {session.tool_call_count > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Wrench size={9} />
                      {session.tool_call_count}
                    </span>
                  )}
                  {formatModel(session.model) && (
                    <span className="px-1 rounded bg-white/5 font-medium">
                      {formatModel(session.model)}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  projects,
  onLaunchProject,
  onAddProject,
  onNewTerminal,
  onResumeSession,
}: SidebarProps) {
  return (
    <div className="w-56 flex flex-col bg-background-secondary/50 border-r border-card-border h-full">
      {/* Quick actions */}
      <div className="p-3 space-y-1">
        <button
          onClick={onNewTerminal}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-white/5"
        >
          <Terminal size={15} />
          <span>New Terminal</span>
        </button>
      </div>

      {/* Projects + sessions */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {projects.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            onLaunch={() => onLaunchProject(project)}
            onResume={onResumeSession}
          />
        ))}

        <button
          onClick={onAddProject}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-white/5 mt-1"
        >
          <Plus size={15} />
          <span>Add Project</span>
        </button>
      </div>
    </div>
  );
}
