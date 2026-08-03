import { useState, useEffect, useCallback, useRef } from "react";
import type React from "react";
import {
  Plus,
  Terminal,
  StickyNote,
  ChevronDown,
  ChevronRight,
  Play,
  MessageSquare,
  Wrench,
  Pencil,
  Trash2,
  GripVertical,
  Star,
  Pin,
  PinOff,
} from "lucide-react";
import type { Project } from "../../types/project";
import { ProviderMenu } from "../terminal/ProviderMenu";
import { useProviders } from "../../hooks/useProviders";
import { providerForModel } from "../../lib/providerMatch";
import { openWithOptions } from "../../lib/sessionOpenWith";
import type { Session } from "../../types/session";
import { formatRelativeTime } from "../../lib/constants";
import { getSessions, setSessionStarred } from "../../lib/ipc";

interface SidebarProps {
  projects: Project[];
  /** Live terminal count per project id for THIS window (zero-count ids absent). */
  terminalCounts: Map<string, number>;
  /** Docked (true) vs hidden-with-edge-hover (false). */
  pinned: boolean;
  onTogglePin: () => void;
  onLaunchProject: (project: Project, provider?: string) => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onReorderProjects: (orderedIds: string[]) => void;
  onNewTerminal: () => void;
  onNewNote: () => void;
  onResumeSession: (
    sessionId: string,
    cwd: string,
    label: string,
    provider?: string
  ) => void;
}

// While a project is expanded, re-read its sessions on this interval so newly
// created sessions, growing message counts, and renames appear without the user
// having to collapse and re-expand. Sessions are .jsonl files on disk that a
// fresh terminal only writes *after* its first message, so a refresh fired on
// terminal spawn would run before the file exists — polling is what reliably
// catches it. Only expanded sections poll, so the cost stays bounded.
const SESSION_POLL_MS = 2500;

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

/** Terminal label for a resumed session: "<project>: <session title>". */
function resumeLabel(projectName: string, session: Session): string {
  return session.custom_title
    ? `${projectName}: ${session.custom_title}`
    : `${projectName}: ${getDisplayTitle(session).slice(0, 40)}`;
}

type ContextMenuState =
  | { kind: "project"; project: Project; x: number; y: number }
  | {
      kind: "session";
      project: Project;
      session: Session;
      x: number;
      y: number;
    };

function ProjectSection({
  project,
  terminalCount,
  isDragging,
  isDragOver,
  onLaunch,
  onResume,
  onContextMenu,
  onSessionContextMenu,
  dragHandleProps,
  rowDragProps,
}: {
  project: Project;
  terminalCount: number;
  isDragging: boolean;
  isDragOver: boolean;
  onLaunch: (provider?: string) => void;
  onResume: (
    sessionId: string,
    cwd: string,
    label: string,
    provider?: string
  ) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: Session) => void;
  dragHandleProps: React.HTMLAttributes<HTMLButtonElement> & { draggable: boolean };
  rowDragProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const providers = useProviders();
  // Bumped on every user mutation (star toggle). A poll whose getSessions
  // request was already in flight when the user clicked holds a pre-mutation
  // snapshot; comparing the version captured before the await against the
  // current one lets us discard that stale snapshot instead of letting it
  // overwrite the optimistic state. The next poll tick delivers truth.
  const mutationVersionRef = useRef(0);

  const loadSessions = useCallback(async () => {
    const version = mutationVersionRef.current;
    try {
      const data = await getSessions(20, project.path);
      if (mutationVersionRef.current === version) setSessions(data);
    } catch (err) {
      console.error("Failed to load sessions for", project.name, err);
    } finally {
      setLoading(false);
    }
  }, [project.path, project.name]);

  // While expanded, load once immediately and then poll. Polling keeps the list
  // live as sessions are created, renamed, or accumulate messages — none of
  // which is observable from a one-shot fetch on expand. The interval is torn
  // down on collapse/unmount so collapsed sections do no work.
  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    loadSessions();
    const interval = setInterval(loadSessions, SESSION_POLL_MS);
    return () => clearInterval(interval);
  }, [expanded, loadSessions]);

  const toggleStar = useCallback(
    async (session: Session) => {
      // Invalidate any in-flight poll so its pre-toggle snapshot can't
      // overwrite the optimistic flip below.
      mutationVersionRef.current += 1;
      // Optimistic flip; the 2.5s poll reconciles ordering and truth.
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === session.session_id ? { ...s, starred: !s.starred } : s
        )
      );
      try {
        await setSessionStarred(session.session_id, !session.starred);
      } catch (err) {
        console.error("Failed to toggle star:", err);
        loadSessions();
      }
    },
    [loadSessions]
  );

  return (
    <div
      {...rowDragProps}
      className={`rounded-lg transition-colors ${
        isDragging ? "opacity-40" : ""
      } ${isDragOver ? "ring-1 ring-accent-cyan/60 bg-accent-cyan/5" : ""}`}
    >
      {/* Project header */}
      <div className="flex items-center gap-1 group" onContextMenu={onContextMenu}>
        {/* Drag handle — only this initiates a reorder drag, so clicking the
            row to expand never starts a drag by accident. */}
        <button
          {...dragHandleProps}
          className="p-0.5 rounded text-foreground-muted/40 hover:text-foreground-muted opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing flex-shrink-0"
          title="Drag to reorder"
          tabIndex={-1}
        >
          <GripVertical size={12} />
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 px-1 py-2 rounded-lg text-left hover:bg-white/5"
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
            <div
              className="text-sm text-foreground truncate"
              title={project.name}
            >
              {project.name}
              {terminalCount > 0 && (
                <span className="ml-1.5 text-xs text-foreground-muted tabular-nums">
                  ({terminalCount})
                </span>
              )}
            </div>
          </div>
        </button>
        <button
          onClick={() => onLaunch()}
          className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent-cyan/20 text-foreground-muted hover:text-accent-cyan flex-shrink-0"
          title={`Launch ${project.terminals} terminal${project.terminals > 1 ? "s" : ""}`}
        >
          <Play size={12} />
        </button>
        <ProviderMenu
          heading={`Launch ${project.name} on`}
          triggerTitle="Launch with provider…"
          triggerClassName="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 text-foreground-muted hover:text-foreground flex-shrink-0 mr-1"
          onPick={(id) => onLaunch(id)}
        />
      </div>

      {/* Sessions dropdown — capped to ~8 visible rows; the rest scroll. */}
      {expanded && (
        <div className="ml-5 border-l border-card-border pl-2 mb-1 max-h-[22rem] overflow-y-auto">
          {loading && sessions.length === 0 ? (
            <div className="px-2 py-2 text-xs text-foreground-muted">
              Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-2 text-xs text-foreground-muted">
              No sessions yet
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.session_id}
                className="relative group/session"
                onContextMenu={(e) => onSessionContextMenu(e, session)}
              >
                <button
                  onClick={() => {
                    // Resume the chat on the provider it originally ran on
                    // (matched via the transcript's recorded model id).
                    onResume(
                      session.session_id,
                      session.cwd,
                      resumeLabel(project.name, session),
                      providerForModel(session.model, providers)
                    );
                  }}
                  className="w-full text-left px-2 py-1.5 pr-7 rounded-md hover:bg-white/5"
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStar(session);
                  }}
                  title={session.starred ? "Unstar" : "Star — keep pinned in this list"}
                  className={`absolute right-1 top-1.5 p-0.5 rounded hover:bg-white/10 ${
                    session.starred
                      ? "text-accent-amber"
                      : "text-foreground-muted opacity-0 group-hover/session:opacity-100"
                  }`}
                >
                  <Star size={12} fill={session.starred ? "currentColor" : "none"} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  projects,
  terminalCounts,
  pinned,
  onTogglePin,
  onLaunchProject,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onReorderProjects,
  onNewTerminal,
  onNewNote,
  onResumeSession,
}: SidebarProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const providers = useProviders();
  // Index of the row being dragged and the row currently hovered as a drop
  // target. Both reset to null when a drag ends.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the context menu on any outside click, Escape, or scroll.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const handleDrop = useCallback(
    (toIndex: number) => {
      setOverIndex(null);
      const from = dragIndex;
      setDragIndex(null);
      if (from === null || from === toIndex) return;
      const next = projects.map((p) => p.id);
      const [moved] = next.splice(from, 1);
      next.splice(toIndex, 0, moved);
      onReorderProjects(next);
    },
    [dragIndex, projects, onReorderProjects]
  );

  return (
    <div className="w-56 flex flex-col bg-background-secondary/25 backdrop-blur-2xl border-r border-white/10 h-full">
      {/* Quick actions */}
      <div className="p-3 space-y-1">
        <div className="flex justify-end">
          <button
            onClick={onTogglePin}
            title={pinned ? "Unpin sidebar (Cmd+B)" : "Pin sidebar (Cmd+B)"}
            className="p-1.5 rounded-md text-foreground-muted hover:text-foreground hover:bg-white/5"
          >
            {pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        </div>
        <button
          onClick={onNewTerminal}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-white/5"
        >
          <Terminal size={15} />
          <span>New Terminal</span>
        </button>
        <button
          onClick={onNewNote}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground-muted hover:text-foreground hover:bg-white/5"
        >
          <StickyNote size={15} />
          <span>New Note</span>
        </button>
      </div>

      {/* Projects + sessions */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {projects.map((project, index) => (
          <ProjectSection
            key={project.id}
            project={project}
            terminalCount={terminalCounts.get(project.id) ?? 0}
            isDragging={dragIndex === index}
            isDragOver={overIndex === index && dragIndex !== index}
            onLaunch={(provider) => onLaunchProject(project, provider)}
            onResume={onResumeSession}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ kind: "project", project, x: e.clientX, y: e.clientY });
            }}
            onSessionContextMenu={(e, session) => {
              e.preventDefault();
              setMenu({
                kind: "session",
                project,
                session,
                x: e.clientX,
                y: e.clientY,
              });
            }}
            dragHandleProps={{
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = "move";
                // Firefox requires data to be set for a drag to start.
                e.dataTransfer.setData("text/plain", project.id);
                setDragIndex(index);
              },
              onDragEnd: () => {
                setDragIndex(null);
                setOverIndex(null);
              },
            }}
            rowDragProps={{
              onDragOver: (e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== index) setOverIndex(index);
              },
              onDrop: (e) => {
                e.preventDefault();
                handleDrop(index);
              },
            }}
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

      {/* Right-click context menu */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[10rem] glass-card py-1 text-sm shadow-xl"
          style={{ top: menu.y, left: menu.x }}
          // Keep clicks inside the menu from bubbling to the window-level
          // dismiss handler before the item's own onClick runs.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {menu.kind === "project" ? (
            <>
              <button
                onClick={() => {
                  onEditProject(menu.project);
                  setMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-white/5"
              >
                <Pencil size={13} />
                Edit project
              </button>
              <button
                onClick={() => {
                  onDeleteProject(menu.project);
                  setMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10"
              >
                <Trash2 size={13} />
                Delete project
              </button>
            </>
          ) : (
            openWithOptions(menu.session.model, providers).map((opt) => (
              <button
                key={opt.providerId}
                onClick={() => {
                  onResumeSession(
                    menu.session.session_id,
                    menu.session.cwd,
                    resumeLabel(menu.project.name, menu.session),
                    opt.providerId
                  );
                  setMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-white/5"
              >
                <Play size={13} />
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
