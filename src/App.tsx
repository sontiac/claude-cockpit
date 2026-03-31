import { useState, useCallback, useEffect, useMemo } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TerminalGrid } from "./components/terminal/TerminalGrid";
import { SessionBrowser } from "./components/session/SessionBrowser";
import { AddProjectModal } from "./components/project/AddProjectModal";
import { useTerminals } from "./hooks/useTerminals";
import { useSessions } from "./hooks/useSessions";
import { useProjects } from "./hooks/useProjects";
import { useNotifications } from "./hooks/useNotifications";
import { useSounds } from "./hooks/useSounds";
import { DEFAULT_COMMAND } from "./lib/constants";
import type { Project } from "./types/project";
import type { TerminalStatus } from "./types/terminal";

type SidebarView = "projects" | "sessions";

export function App() {
  const {
    terminals,
    activeId,
    setActiveId,
    spawn,
    kill,
    rename,
    updateStatus,
  } = useTerminals();

  const { projects, add: addProject, update: updateProject } =
    useProjects();

  // Derive project paths from saved projects
  const projectPaths = useMemo(
    () => projects.map((p) => p.path),
    [projects]
  );

  const {
    sessions,
    filterPath,
    setFilterPath,
    loading: sessionsLoading,
    refresh: refreshSessions,
  } = useSessions({ projectPaths });

  const { notify } = useNotifications();
  const { play } = useSounds();

  const [sidebarView, setSidebarView] = useState<SidebarView>("projects");
  const [showAddProject, setShowAddProject] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [showSessions, setShowSessions] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "t") {
          e.preventDefault();
          handleNewTerminal();
        } else if (e.key === "w") {
          e.preventDefault();
          if (activeId) kill(activeId);
        } else if (e.key >= "1" && e.key <= "9") {
          e.preventDefault();
          const idx = parseInt(e.key) - 1;
          if (idx < terminals.length) {
            setActiveId(terminals[idx].id);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeId, terminals, kill, setActiveId]);

  const handleNewTerminal = useCallback(async () => {
    await spawn();
  }, [spawn]);

  const handleLaunchProject = useCallback(
    async (project: Project) => {
      play("launch");
      for (let i = 0; i < project.terminals; i++) {
        await spawn({
          cwd: project.path,
          command: project.command ?? DEFAULT_COMMAND,
          label: `${project.name} ${project.terminals > 1 ? i + 1 : ""}`.trim(),
          color: project.color,
          projectId: project.id,
        });
      }
    },
    [spawn, play]
  );

  const handleResumeSession = useCallback(
    async (sessionId: string, cwd: string) => {
      play("click");
      await spawn({
        cwd,
        resumeSessionId: sessionId,
        label: "Resumed",
      });
    },
    [spawn, play]
  );

  const handleStatusChange = useCallback(
    (id: string, status: TerminalStatus) => {
      updateStatus(id, status);

      // Notify when Claude finishes (status changes to idle from responding)
      if (status === "idle") {
        const terminal = terminals.find((t) => t.id === id);
        if (terminal && terminal.status === "responding") {
          play("success");
          // Only notify if window is not focused
          if (!document.hasFocus()) {
            notify(
              "Claude finished",
              `${terminal.label} is ready for input`
            );
          }
        }
      }
    },
    [updateStatus, terminals, play, notify]
  );

  const handleExit = useCallback(
    (id: string, _code: number | null) => {
      updateStatus(id, "exited");
    },
    [updateStatus]
  );

  return (
    <div className="flex flex-col h-screen bg-background">
      <TitleBar />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          projects={projects}
          onLaunchProject={handleLaunchProject}
          onAddProject={() => setShowAddProject(true)}
          onShowSessions={refreshSessions}
          onNewTerminal={handleNewTerminal}
          activeView={sidebarView}
          onViewChange={(view) => {
            setSidebarView(view);
            setShowSessions(view === "sessions");
          }}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {showSessions && sidebarView === "sessions" ? (
            <SessionBrowser
              sessions={sessions}
              projectPaths={projectPaths}
              filterPath={filterPath}
              onFilterChange={setFilterPath}
              onResume={handleResumeSession}
              onRefresh={refreshSessions}
              loading={sessionsLoading}
            />
          ) : (
            <TerminalGrid
              terminals={terminals}
              activeId={activeId}
              onSelect={setActiveId}
              onClose={kill}
              onRename={rename}
              onStatusChange={handleStatusChange}
              onExit={handleExit}
              onNewTerminal={handleNewTerminal}
            />
          )}
        </div>
      </div>

      <StatusBar terminals={terminals} />

      <AddProjectModal
        open={showAddProject || editProject !== null}
        onClose={() => {
          setShowAddProject(false);
          setEditProject(null);
        }}
        onSave={(project) => {
          if (editProject) {
            updateProject(project);
          } else {
            addProject(project);
          }
          play("success");
        }}
        editProject={editProject}
      />
    </div>
  );
}
