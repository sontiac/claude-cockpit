import { ProjectCard } from "./ProjectCard";
import type { Project } from "../../types/project";

interface ProjectListProps {
  projects: Project[];
  onLaunch: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
}

export function ProjectList({
  projects,
  onLaunch,
  onEdit,
  onDelete,
}: ProjectListProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onLaunch={() => onLaunch(project)}
          onEdit={() => onEdit(project)}
          onDelete={() => onDelete(project)}
        />
      ))}
    </div>
  );
}
