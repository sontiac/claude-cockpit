import { Play, Pencil, Trash2, Terminal } from "lucide-react";
import { shortenPath } from "../../lib/utils";
import type { Project } from "../../types/project";

interface ProjectCardProps {
  project: Project;
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProjectCard({
  project,
  onLaunch,
  onEdit,
  onDelete,
}: ProjectCardProps) {
  return (
    <div className="glass-card p-4 group">
      <div className="flex items-start gap-3">
        <div
          className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground">
            {project.name}
          </h3>
          <p className="path-text truncate mt-0.5">
            {shortenPath(project.path)}
          </p>
          <div className="flex items-center gap-1 mt-1 text-xs text-foreground-muted">
            <Terminal size={11} />
            <span>
              {project.terminals} terminal{project.terminals !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onLaunch}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-accent-cyan/20 text-accent-cyan hover:bg-accent-cyan/30 text-xs font-medium"
        >
          <Play size={12} />
          Launch
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-white/10 text-foreground-muted hover:text-foreground"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-red-500/20 text-foreground-muted hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
