import {
  Plus,
  FolderOpen,
  History,
  Terminal,
  ChevronRight,
} from "lucide-react";
import type { Project } from "../../types/project";
import { shortenPath } from "../../lib/utils";

type SidebarView = "projects" | "sessions";

interface SidebarProps {
  projects: Project[];
  onLaunchProject: (project: Project) => void;
  onAddProject: () => void;
  onShowSessions: () => void;
  onNewTerminal: () => void;
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

export function Sidebar({
  projects,
  onLaunchProject,
  onAddProject,
  onShowSessions,
  onNewTerminal,
  activeView,
  onViewChange,
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

      {/* Nav tabs */}
      <div className="px-3 flex gap-1 mb-2">
        <button
          onClick={() => onViewChange("projects")}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === "projects"
              ? "bg-white/10 text-foreground"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          <FolderOpen size={13} className="inline mr-1" />
          Projects
        </button>
        <button
          onClick={() => {
            onViewChange("sessions");
            onShowSessions();
          }}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === "sessions"
              ? "bg-white/10 text-foreground"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          <History size={13} className="inline mr-1" />
          Sessions
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {activeView === "projects" && (
          <div className="space-y-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => onLaunchProject(project)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/5 group"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">
                    {project.name}
                  </div>
                  <div className="path-text truncate">
                    {shortenPath(project.path)}
                  </div>
                </div>
                <ChevronRight
                  size={14}
                  className="text-foreground-muted opacity-0 group-hover:opacity-100"
                />
              </button>
            ))}

            <button
              onClick={onAddProject}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-white/5"
            >
              <Plus size={15} />
              <span>Add Project</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
