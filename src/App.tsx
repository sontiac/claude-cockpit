import { useState, useCallback, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { WorkspaceBar } from "./components/layout/WorkspaceBar";
import { TerminalGrid } from "./components/terminal/TerminalGrid";
import { RestoreModal } from "./components/terminal/RestoreModal";
import { AddProjectModal } from "./components/project/AddProjectModal";
import { useTerminals } from "./hooks/useTerminals";
import { usePanes } from "./hooks/usePanes";
import { useProjects } from "./hooks/useProjects";
import { useFontSizeController, FontSizeContext } from "./hooks/useFontSize";
import { useNotifications } from "./hooks/useNotifications";
import { useSounds } from "./hooks/useSounds";
import { setSessionTitle, openWindow, cycleWindow, quitApp } from "./lib/ipc";
import { sessionIdFromCommand } from "./lib/restore";
import { closeConfirmMessage } from "./lib/windowClose";
import { DEFAULT_COMMAND } from "./lib/constants";
import { paneCountLabel } from "./lib/paneCounts";
import { useTheme } from "./hooks/useTheme";
import type { Project } from "./types/project";
import type { TerminalStatus } from "./types/terminal";
import type { Pane, CanvasPaneKind } from "./types/pane";

export function App() {
  const {
    terminals,
    activeId,
    setActiveId,
    spawn,
    kill,
    rename,
    moveTerminal,
    updateStatus,
    restorePrompt,
    recover,
    discard,
    forgetWindowTerminals,
    workspaces,
    activeWorkspaceId,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useTerminals();

  const {
    panes,
    addPane,
    renamePane: renameCanvasPane,
    movePane: moveCanvasPane,
    removePane,
    reassignPanes,
    discardPanes,
    forgetWindowPanes,
    setPanePath,
    setPomodoroDurations,
  } = usePanes();

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
    async (workspaceId?: string, provider?: string) => {
      await spawn({ workspaceId, provider });
    },
    [spawn]
  );

  const handleNewPane = useCallback(
    (kind: CanvasPaneKind, workspaceId?: string) => {
      const pane = addPane(kind, workspaceId ?? activeWorkspaceId);
      setActiveId(pane.id);
      play("launch");
    },
    [addPane, activeWorkspaceId, setActiveId, play]
  );

  const closePane = useCallback(
    (id: string) => {
      const pane = panes.find((p) => p.id === id);
      if (pane) {
        if (
          pane.kind === "note" &&
          !window.confirm(
            `Delete note "${pane.label}"? Its contents will be permanently removed.`
          )
        ) {
          return;
        }
        removePane(id);
        if (activeId === id) setActiveId(null);
        play("click");
        return;
      }
      kill(id);
    },
    [panes, removePane, kill, activeId, setActiveId, play]
  );

  const renamePane = useCallback(
    (id: string, label: string) => {
      if (panes.some((p) => p.id === id)) renameCanvasPane(id, label);
      else rename(id, label);
    },
    [panes, renameCanvasPane, rename]
  );

  const movePane = useCallback(
    (id: string, workspaceId: string) => {
      if (panes.some((p) => p.id === id)) moveCanvasPane(id, workspaceId);
      else moveTerminal(id, workspaceId);
    },
    [panes, moveCanvasPane, moveTerminal]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Option+Tab cycles cockpit windows (Option+Shift+Tab reverses).
      // preventDefault stops the focused terminal from receiving a Tab.
      if (e.altKey && e.code === "Tab") {
        e.preventDefault();
        cycleWindow(e.shiftKey ? "prev" : "next").catch(console.error);
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "n" && e.shiftKey) {
          e.preventDefault();
          handleNewPane("note");
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
    setActiveId,
    increase,
    decrease,
    reset,
    handleNewTerminal,
    handleNewPane,
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

  const workspacePaneCounts = useMemo(() => {
    const result: Record<string, { count: number; label: string }> = {};
    for (const ws of workspaces) {
      const wsPanes = panes.filter((p) => p.workspaceId === ws.id);
      if (wsPanes.length > 0) {
        result[ws.id] = { count: wsPanes.length, label: paneCountLabel(wsPanes) };
      }
    }
    return result;
  }, [panes, workspaces]);

  const handleLaunchProject = useCallback(
    async (project: Project, provider?: string) => {
      play("launch");
      for (let i = 0; i < project.terminals; i++) {
        await spawn({
          cwd: project.path,
          command: project.command ?? DEFAULT_COMMAND,
          label: `${project.name} ${project.terminals > 1 ? i + 1 : ""}`.trim(),
          color: project.color,
          projectId: project.id,
          provider,
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
    await Promise.all([discard(), discardPanes()]);
  }, [discard, discardPanes]);

  // Title-bar ✕: close only THIS window when others are open (confirming first
  // if it holds terminals or panes, since closing forgets them). When it's the
  // last window, quit the whole app (recoverable via the restore prompt).
  const handleCloseWindow = useCallback(async () => {
    // Only quit the whole app when we can CONFIRM this is the last window. If the
    // window count can't be read, fail safe by closing just this window rather
    // than quitting every other open window (the original bug's failure mode).
    let windowCount: number | null = null;
    try {
      windowCount = (await getAllWindows()).length;
    } catch (e) {
      console.error("Failed to count windows; closing just this window:", e);
    }

    if (windowCount === 1) {
      await quitApp().catch((e) => console.error("Failed to quit:", e));
      return;
    }

    const confirmMsg = closeConfirmMessage(terminals.length, panes.length);
    if (confirmMsg && !window.confirm(confirmMsg)) return;

    // Order matters: kill/forget this window's terminals and panes (both disarm
    // their persistence) before closing the window, so nothing re-saves.
    await forgetWindowTerminals();
    await forgetWindowPanes();
    // Use close() (not destroy()): destroy requires core:window:allow-destroy,
    // which is NOT in our capabilities, so it would silently reject and leave the
    // window open. close() is covered by core:window:allow-close.
    await getCurrentWindow()
      .close()
      .catch((e) => console.error("Failed to close window:", e));
  }, [terminals.length, panes.length, forgetWindowTerminals, forgetWindowPanes]);

  const handleDeleteWorkspace = useCallback(
    (id: string) => {
      const remaining = workspaces.filter((w) => w.id !== id);
      if (remaining.length === 0) return; // mirror deleteWorkspace's guard
      reassignPanes(id, remaining[0].id);
      deleteWorkspace(id);
    },
    [workspaces, reassignPanes, deleteWorkspace]
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
      <TitleBar onClose={handleCloseWindow} />

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
          onNewNote={() => handleNewPane("note")}
          onResumeSession={handleResumeSession}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <WorkspaceBar
            workspaces={workspaces}
            activeId={activeWorkspaceId}
            counts={workspaceCounts}
            paneCounts={workspacePaneCounts}
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
                ...panes.filter((p) => p.workspaceId === ws.id),
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
                    onNewTerminal={(provider) => handleNewTerminal(ws.id, provider)}
                    onNewPane={(kind) => handleNewPane(kind, ws.id)}
                    onSetPanePath={setPanePath}
                    onSetPomodoroDurations={setPomodoroDurations}
                    workspaces={workspaces}
                    onMovePane={movePane}
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
