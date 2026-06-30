import { useState, useCallback, useEffect } from "react";
import type { CSSProperties } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TerminalGrid } from "./components/terminal/TerminalGrid";
import { RestoreModal } from "./components/terminal/RestoreModal";
import { AddProjectModal } from "./components/project/AddProjectModal";
import { useTerminals } from "./hooks/useTerminals";
import { useProjects } from "./hooks/useProjects";
import { useFontSizeController, FontSizeContext } from "./hooks/useFontSize";
import { useNotifications } from "./hooks/useNotifications";
import { useSounds } from "./hooks/useSounds";
import { setSessionTitle } from "./lib/ipc";
import { sessionIdFromCommand } from "./lib/restore";
import { DEFAULT_COMMAND } from "./lib/constants";
import { useTheme } from "./hooks/useTheme";
import type { Project } from "./types/project";
import type { TerminalStatus } from "./types/terminal";

export function App() {
  const {
    terminals,
    activeId,
    setActiveId,
    spawn,
    kill,
    rename,
    updateStatus,
    restorable,
    restore,
    dismissRestore,
  } = useTerminals();

  const {
    projects,
    add: addProject,
    update: updateProject,
    remove: removeProject,
    reorder: reorderProjects,
  } = useProjects();

  const { notify } = useNotifications();
  const { play } = useSounds();
  const { fontSize, increase, decrease, reset } = useFontSizeController();
  const { theme, setTheme, themes, uploadBackground, removeBackground } =
    useTheme();

  const [showAddProject, setShowAddProject] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);

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
        } else if (e.key === "=" || e.key === "+") {
          // Cmd/Ctrl + '+' zooms the terminal font in. preventDefault also stops
          // the webview from zooming the whole page.
          e.preventDefault();
          increase();
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          decrease();
        } else if (e.key === "0") {
          e.preventDefault();
          reset();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeId, terminals, kill, setActiveId, increase, decrease, reset]);

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
    async (sessionId: string, cwd: string, label: string) => {
      play("click");
      await spawn({
        cwd,
        resumeSessionId: sessionId,
        label,
      });
    },
    [spawn, play]
  );

  // Claude reports the session name via the terminal title. Always keep the
  // project (or folder) name as the prefix: "<project> : <session name>".
  const handleSessionRename = useCallback(
    (id: string, sessionName: string) => {
      const terminal = terminals.find((t) => t.id === id);
      const project = terminal?.project_id
        ? projects.find((p) => p.id === terminal.project_id)
        : undefined;
      const prefix =
        project?.name || terminal?.cwd.split("/").filter(Boolean).pop() || "";
      rename(id, prefix ? `${prefix} : ${sessionName}` : sessionName);

      // Record the rename against the terminal's session so it sticks in the
      // sidebar and survives restarts (Claude doesn't persist /rename to disk
      // when run inside cockpit's PTY).
      const sessionId = terminal && sessionIdFromCommand(terminal.command);
      if (sessionId) {
        setSessionTitle(sessionId, sessionName).catch((e) =>
          console.error("Failed to save session title:", e)
        );
      }
    },
    [terminals, projects, rename]
  );

  const handleStatusChange = useCallback(
    (id: string, status: TerminalStatus) => {
      updateStatus(id, status);

      if (status === "idle") {
        const terminal = terminals.find((t) => t.id === id);
        if (terminal && terminal.status === "responding") {
          play("success");
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
    <FontSizeContext.Provider value={fontSize}>
    {/* Full-window background image + legibility scrim, behind all content. */}
    <div className="app-bg" style={{ backgroundImage: `url(${theme.image})` }} />
    <div
      className="app-bg-scrim"
      style={{ "--scrim": theme.scrim } as CSSProperties}
    />
    <div className="flex flex-col h-screen bg-transparent">
      <TitleBar />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          projects={projects}
          onLaunchProject={handleLaunchProject}
          onAddProject={() => setShowAddProject(true)}
          onEditProject={(project) => setEditProject(project)}
          onDeleteProject={(project) => {
            if (
              window.confirm(
                `Remove "${project.name}" from cockpit? This only removes the project entry — your files and Claude sessions are untouched.`
              )
            ) {
              removeProject(project.id);
              play("click");
            }
          }}
          onReorderProjects={reorderProjects}
          onNewTerminal={handleNewTerminal}
          onResumeSession={handleResumeSession}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TerminalGrid
            terminals={terminals}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={kill}
            onRename={rename}
            onSessionRename={handleSessionRename}
            onStatusChange={handleStatusChange}
            onExit={handleExit}
            onNewTerminal={handleNewTerminal}
          />
        </div>
      </div>

      <StatusBar
        terminals={terminals}
        fontSize={fontSize}
        onIncreaseFont={increase}
        onDecreaseFont={decrease}
        onResetFont={reset}
        themes={themes}
        currentThemeId={theme.id}
        onSelectTheme={setTheme}
        onUploadTheme={uploadBackground}
        onRemoveTheme={removeBackground}
      />

      {/* Mounted only while open, keyed by the target, so the form's initial
          state is always seeded fresh from the project being edited (or empty
          for a new one) — the modal's useState would otherwise retain the last
          project's values across opens. */}
      {(showAddProject || editProject !== null) && (
        <AddProjectModal
          key={editProject?.id ?? "new"}
          open
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
      )}

      <RestoreModal
        terminals={restorable}
        onRestore={restore}
        onDismiss={dismissRestore}
      />
    </div>
    </FontSizeContext.Provider>
  );
}
