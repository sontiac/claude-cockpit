import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { Session } from "../../types/session";

const sessions: Session[] = [
  {
    session_id: "s-starred",
    slug: null,
    first_message: 0,
    last_message: Date.now(),
    message_count: 3,
    tool_call_count: 0,
    cwd: "/tmp/proj",
    summary: null,
    model: null,
    git_branch: null,
    custom_title: "Important chat",
    first_user_message: null,
    starred: true,
  },
  {
    session_id: "s-plain",
    slug: null,
    first_message: 0,
    last_message: Date.now(),
    message_count: 1,
    tool_call_count: 0,
    cwd: "/tmp/proj",
    summary: null,
    model: null,
    git_branch: null,
    custom_title: "Plain chat",
    first_user_message: null,
    starred: false,
  },
];

vi.mock("../../lib/ipc", () => ({
  getSessions: vi.fn(async () => sessions),
  setSessionStarred: vi.fn(async () => undefined),
  listProviders: vi.fn(async () => [
    { id: "claude", label: "Claude", contextWindow: 1048576, model: null },
    { id: "kimi", label: "Kimi", contextWindow: 1048576, model: "k3[1m]" },
  ]),
}));

import { getSessions, setSessionStarred } from "../../lib/ipc";

const project = {
  id: "p1",
  name: "proj",
  path: "/tmp/proj",
  color: "#06b6d4",
  terminals: 1,
  command: null,
};

function renderSidebar() {
  return render(
    <Sidebar
      projects={[project]}
      onLaunchProject={vi.fn()}
      onAddProject={vi.fn()}
      onEditProject={vi.fn()}
      onDeleteProject={vi.fn()}
      onReorderProjects={vi.fn()}
      onNewTerminal={vi.fn()}
      onNewNote={vi.fn()}
      onResumeSession={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.mocked(getSessions).mockClear();
  vi.mocked(setSessionStarred).mockClear();
});

describe("Sidebar session starring", () => {
  it("toggles a session's star over IPC", async () => {
    renderSidebar();
    fireEvent.click(screen.getByText("proj")); // expand
    await waitFor(() => expect(screen.getByText("Important chat")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Unstar")); // starred row shows Unstar
    expect(setSessionStarred).toHaveBeenCalledWith("s-starred", false);
  });

  it("stars an unstarred session", async () => {
    renderSidebar();
    fireEvent.click(screen.getByText("proj"));
    await waitFor(() => expect(screen.getByText("Plain chat")).toBeInTheDocument());
    const starButtons = screen.getAllByTitle("Star — keep pinned in this list");
    fireEvent.click(starButtons[0]);
    expect(setSessionStarred).toHaveBeenCalledWith("s-plain", true);
  });

  it("keeps an optimistic flip when a poll started before the click resolves after it", async () => {
    // The sidebar re-polls getSessions every 2.5s while expanded. A poll whose
    // request is already in flight when the user clicks the star holds a
    // pre-toggle snapshot; when it resolves it must NOT overwrite the
    // optimistic flip (the star would visually un-flip until the next poll).
    vi.useFakeTimers();
    try {
      const preToggle: Session[] = [{ ...sessions[1] }]; // "Plain chat", starred: false
      let resolvePoll!: (value: Session[]) => void;
      vi.mocked(getSessions)
        .mockImplementationOnce(async () => preToggle) // initial load on expand
        .mockImplementationOnce(
          () => new Promise<Session[]>((resolve) => (resolvePoll = resolve))
        );

      renderSidebar();
      fireEvent.click(screen.getByText("proj"));
      await act(async () => {}); // flush the initial load
      expect(screen.getByText("Plain chat")).toBeInTheDocument();

      // First poll tick fires; its getSessions promise stays pending.
      act(() => {
        vi.advanceTimersByTime(2500);
      });

      // User stars the session while that poll is in flight.
      fireEvent.click(screen.getByTitle("Star — keep pinned in this list"));
      await act(async () => {}); // flush the optimistic setState + IPC promise
      expect(screen.getByTitle("Unstar")).toBeInTheDocument();

      // The stale (pre-toggle) snapshot resolves — it must be discarded.
      await act(async () => {
        resolvePoll(preToggle);
      });
      expect(screen.getByTitle("Unstar")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Sidebar project reordering", () => {
  // Requires dragDropEnabled=false in tauri.conf.json (and
  // disable_drag_drop_handler in open_window) — with Tauri's native handler
  // on, DOM drop events never fire on macOS and this flow is dead in the app
  // no matter what the React handlers do.
  it("reorders projects when a row is dragged onto another", () => {
    const projects = [
      { ...project, id: "p1", name: "alpha" },
      { ...project, id: "p2", name: "beta" },
      { ...project, id: "p3", name: "gamma" },
    ];
    const onReorderProjects = vi.fn();
    render(
      <Sidebar
        projects={projects}
        onLaunchProject={vi.fn()}
        onAddProject={vi.fn()}
        onEditProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onReorderProjects={onReorderProjects}
        onNewTerminal={vi.fn()}
        onNewNote={vi.fn()}
        onResumeSession={vi.fn()}
      />
    );
    const dt = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    const handles = screen.getAllByTitle("Drag to reorder");
    fireEvent.dragStart(handles[0], { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith("text/plain", "p1");
    // Drop anywhere inside the "gamma" row — the drop handler sits on the row
    // and the event bubbles.
    fireEvent.dragOver(screen.getByText("gamma"), { dataTransfer: dt });
    fireEvent.drop(screen.getByText("gamma"), { dataTransfer: dt });
    expect(onReorderProjects).toHaveBeenCalledWith(["p2", "p3", "p1"]);
  });
});

describe("Sidebar project provider launch", () => {
  it("launches a project on a picked provider", async () => {
    const onLaunchProject = vi.fn();
    render(
      <Sidebar
        projects={[project]}
        onLaunchProject={onLaunchProject}
        onAddProject={vi.fn()}
        onEditProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onReorderProjects={vi.fn()}
        onNewTerminal={vi.fn()}
        onNewNote={vi.fn()}
        onResumeSession={vi.fn()}
      />
    );
    // The chevron appears once the (async) provider list arrives.
    await waitFor(() =>
      expect(screen.getByTitle("Launch with provider…")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTitle("Launch with provider…"));
    fireEvent.click(screen.getByText("Kimi"));
    expect(onLaunchProject).toHaveBeenCalledWith(project, "kimi");
  });

  it("resumes a session on the provider its recorded model maps to", async () => {
    const onResumeSession = vi.fn();
    const kimiSession: Session = {
      ...sessions[1],
      session_id: "s-kimi",
      custom_title: "Kimi chat",
      model: "k3",
    };
    vi.mocked(getSessions).mockResolvedValue([kimiSession]);
    render(
      <Sidebar
        projects={[project]}
        onLaunchProject={vi.fn()}
        onAddProject={vi.fn()}
        onEditProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onReorderProjects={vi.fn()}
        onNewTerminal={vi.fn()}
        onNewNote={vi.fn()}
        onResumeSession={onResumeSession}
      />
    );
    fireEvent.click(screen.getByText("proj")); // expand sessions
    await waitFor(() => expect(screen.getByText("Kimi chat")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Kimi chat"));
    expect(onResumeSession).toHaveBeenCalledWith(
      "s-kimi",
      "/tmp/proj",
      expect.stringContaining("Kimi chat"),
      "kimi"
    );
    vi.mocked(getSessions).mockResolvedValue(sessions);
  });

  it("plain Play launch passes no provider", () => {
    const onLaunchProject = vi.fn();
    render(
      <Sidebar
        projects={[project]}
        onLaunchProject={onLaunchProject}
        onAddProject={vi.fn()}
        onEditProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onReorderProjects={vi.fn()}
        onNewTerminal={vi.fn()}
        onNewNote={vi.fn()}
        onResumeSession={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTitle("Launch 1 terminal"));
    expect(onLaunchProject).toHaveBeenCalledWith(project, undefined);
  });
});
