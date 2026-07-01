import { useState, useCallback, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { WorkspaceBar } from "./components/layout/WorkspaceBar";
import { TerminalGrid } from "./components/terminal/TerminalGrid";
import { RestoreModal } from "./components/terminal/RestoreModal";
import { AddProjectModal } from "./components/project/AddProjectModal";
import { useTerminals } from "./hooks/useTerminals";
import { useNotes } from "./hooks/useNotes";
import { useProjects } from "./hooks/useProjects";
import { useFontSizeController, FontSizeContext } from "./hooks/useFontSize";
import { useNotifications } from "./hooks/useNotifications";
import { useSounds } from "./hooks/useSounds";
import { setSessionTitle, openWindow } from "./lib/ipc";
import { sessionIdFromCommand } from "./lib/restore";
import { DEFAULT_COMMAND } from "./lib/constants";
import { useTheme } from "./hooks/useTheme";
import type { Project } from "./types/project";
import type { TerminalStatus } from "./types/terminal";
import type { Pane } from "./types/pane";

export function App() {
  const {
    terminals,
    activeId,
    setActiveId,
    spawn,
    kill,
    rename,
    updateStatus,
    restorePrompt,
    recover,
    discard,
    workspaces,
    activeWorkspaceId,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useTerminals();

  const {
    notes,
    addNote,
    renameNote,
    removeNote,
    reassignNotes,
    discardNotes,
  } = useNotes();

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

  const handleNewTerminal = useCallback(
    async (workspaceId?: string) => {
      await spawn({ workspaceId });
    },
    [spawn]
  );

  const handleNewNote = useCallback(
    (workspaceId?: string) => {
      const note = addNote(workspaceId ?? activeWorkspaceId);
      setActiveId(note.id);
      play("launch");
    },
    [addNote, activeWorkspaceId, setActiveId, play]
  );

  const closePane = useCallback(
    (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (note) {
        if (
          window.confirm(
            `Delete note "${note.label}"? Its contents will be permanently removed.`
          )
        ) {
          removeNote(id);
          if (activeId === id) setActiveId(null);
          play("click");
        }
        return;
      }
      kill(id);
    },
    [notes, removeNote, kill, activeId, setActiveId, play]
  );

  const renamePane = useCallback(
    (id: string, label: string) => {
      if (notes.some((n) => n.id === id)) renameNote(id, label);
      else rename(id, label);
    },
    [notes, renameNote, rename]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "n" && e.shiftKey) {
          e.preventDefault();
          handleNewNote();
          return;
        }
        if (e.key === "t") {
          e.preventDefault();
          handleNewTerminal();
        } else if (e.key === "w") {
          e.preventDefault();
          if (activeId) closePane(activeId);
        } else if (e.key >= "1" && e.key <= "9") {
          e.preventDefault();
          // Select the Nth terminal within the active workspace.
          const idx = parseInt(e.key) - 1;
          const inWs = terminals.filter(
            (t) => t.workspaceId === activeWorkspaceId
          );
          if (idx < inWs.length) {
            setActiveId(inWs[idx].id);
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
  }, [
    activeId,
    terminals,
    activeWorkspaceId,
    kill,
    setActiveId,
    increase,
    decrease,
    reset,
    handleNewNote,
    closePane,
  ]);

  // Live terminal count per workspace, for the workspace tabs.
  const workspaceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of terminals) {
      counts[t.workspaceId] = (counts[t.workspaceId] ?? 0) + 1;
    }
    return counts;
  }, [terminals]);

  const workspaceNoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of notes) {
      counts[n.workspaceId] = (counts[n.workspaceId] ?? 0) + 1;
    }
    return counts;
  }, [notes]);

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

  const handleDiscard = useCallback(async () => {
    await Promise.all([discard(), discardNotes()]);
  }, [discard, discardNotes]);

  const handleDeleteWorkspace = useCallback(
    (id: string) => {
      const remaining = workspaces.filter((w) => w.id !== id);
      if (remaining.length === 0) return; // mirror deleteWorkspace's guard
      reassignNotes(id, remaining[0].id);
      deleteWorkspace(id);
    },
    [workspaces, reassignNotes, deleteWorkspace]
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
          onNewTerminal={() => handleNewTerminal()}
          onResumeSession={handleResumeSession}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <WorkspaceBar
            workspaces={workspaces}
            activeId={activeWorkspaceId}
            counts={workspaceCounts}
            noteCounts={workspaceNoteCounts}
            onSwitch={switchWorkspace}
            onCreate={createWorkspace}
            onRename={renameWorkspace}
            onDelete={handleDeleteWorkspace}
            onNewWindow={() => openWindow().catch(console.error)}
          />

          {/* One canvas per workspace, stacked. Inactive ones stay mounted
              (terminals keep running, screens stay live) but hidden, so
              switching workspaces never blanks a session. */}
          <div className="relative flex-1 min-h-0">
            {workspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              const wsPanes: Pane[] = [
                ...terminals
                  .filter((t) => t.workspaceId === ws.id)
                  .map((t) => ({ kind: "terminal" as const, ...t })),
                ...notes
                  .filter((n) => n.workspaceId === ws.id)
                  .map((n) => ({ kind: "note" as const, ...n })),
              ];
              return (
                <div
                  key={ws.id}
                  className="absolute inset-0 flex flex-col"
                  style={{
                    visibility: isActive ? "visible" : "hidden",
                    zIndex: isActive ? 1 : 0,
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                >
                  <TerminalGrid
                    panes={wsPanes}
                    activeId={activeId}
                    onSelect={setActiveId}
                    onClosePane={closePane}
                    onRenamePane={renamePane}
                    onSessionRename={handleSessionRename}
                    onStatusChange={handleStatusChange}
                    onExit={handleExit}
                    onNewTerminal={() => handleNewTerminal(ws.id)}
                    onNewNote={() => handleNewNote(ws.id)}
                  />
                </div>
              );
            })}
          </div>
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
        open={restorePrompt !== null}
        terminalCount={restorePrompt?.terminalCount ?? 0}
        windowCount={restorePrompt?.windowCount ?? 0}
        onRecover={recover}
        onDiscard={handleDiscard}
      />
    </div>
    </FontSizeContext.Provider>
  );
}
