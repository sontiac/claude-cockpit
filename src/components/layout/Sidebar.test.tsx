import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { SidebarReveal } from "./SidebarReveal";
import type { Session } from "../../types/session";
import type { Project } from "../../types/project";

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

const project: Project = {
  id: "p1",
  name: "proj",
  path: "/tmp/proj",
  color: "#06b6d4",
  terminals: 1,
  command: null,
};

function buildSidebarProps(
  overrides: Partial<Parameters<typeof Sidebar>[0]> = {}
): Parameters<typeof Sidebar>[0] {
  return {
    projects: [project],
    terminalCounts: new Map<string, number>(),
    pinned: false,
    onTogglePin: vi.fn(),
    onLaunchProject: vi.fn(),
    onAddProject: vi.fn(),
    onEditProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onReorderProjects: vi.fn(),
    onNewTerminal: vi.fn(),
    onNewNote: vi.fn(),
    onResumeSession: vi.fn(),
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(<Sidebar {...buildSidebarProps(overrides)} />);
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
  // Reordering lives in the right-click menu (Move up / Move down) rather
  // than drag-and-drop: HTML5 dnd is dead once Tauri's native drag-drop
  // handler is enabled, and the per-row drag handle wasted row width.
  const projects = [
    { ...project, id: "p1", name: "alpha" },
    { ...project, id: "p2", name: "beta" },
    { ...project, id: "p3", name: "gamma" },
  ];

  it("moves a project up one slot from its context menu", () => {
    const onReorderProjects = vi.fn();
    renderSidebar({ projects, onReorderProjects });
    fireEvent.contextMenu(screen.getByText("beta"));
    fireEvent.click(screen.getByText("Move up"));
    expect(onReorderProjects).toHaveBeenCalledWith(["p2", "p1", "p3"]);
    // The menu closes after picking.
    expect(screen.queryByText("Move up")).not.toBeInTheDocument();
  });

  it("moves a project down one slot from its context menu", () => {
    const onReorderProjects = vi.fn();
    renderSidebar({ projects, onReorderProjects });
    fireEvent.contextMenu(screen.getByText("beta"));
    fireEvent.click(screen.getByText("Move down"));
    expect(onReorderProjects).toHaveBeenCalledWith(["p1", "p3", "p2"]);
  });

  it("disables Move up on the first project and Move down on the last", () => {
    renderSidebar({ projects });

    fireEvent.contextMenu(screen.getByText("alpha"));
    expect(screen.getByText("Move up").closest("button")).toBeDisabled();
    expect(screen.getByText("Move down").closest("button")).not.toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });

    fireEvent.contextMenu(screen.getByText("gamma"));
    expect(screen.getByText("Move down").closest("button")).toBeDisabled();
    expect(screen.getByText("Move up").closest("button")).not.toBeDisabled();
  });

  it("renders no drag handle on project rows", () => {
    renderSidebar({ projects });
    expect(screen.queryByTitle("Drag to reorder")).not.toBeInTheDocument();
  });
});

describe("Sidebar project provider launch", () => {
  it("launches a project on a picked provider", async () => {
    const onLaunchProject = vi.fn();
    renderSidebar({ onLaunchProject });
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
    renderSidebar({ onResumeSession });
    fireEvent.click(screen.getByText("proj")); // expand sessions
    await waitFor(() => expect(screen.getByText("Kimi chat")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Kimi chat"));
    // The project id rides along so resumed terminals count toward their
    // project's sidebar tally (they used to spawn project-less).
    expect(onResumeSession).toHaveBeenCalledWith(
      "s-kimi",
      "/tmp/proj",
      expect.stringContaining("Kimi chat"),
      "kimi",
      "p1"
    );
    vi.mocked(getSessions).mockResolvedValue(sessions);
  });

  it("right-click on a session offers Open with…, current provider first", async () => {
    const onResumeSession = vi.fn();
    renderSidebar({ onResumeSession });
    fireEvent.click(screen.getByText("proj")); // expand sessions
    await waitFor(() => expect(screen.getByText("Plain chat")).toBeInTheDocument());

    // "Plain chat" has no recorded model → it ran on the default (Claude).
    fireEvent.contextMenu(screen.getByText("Plain chat"));
    await waitFor(() =>
      expect(screen.getByText("Open with Claude (current)")).toBeInTheDocument()
    );
    const rows = screen.getAllByText(/^Open with /);
    expect(rows[0]).toHaveTextContent("Open with Claude (current)");

    // Picking the other provider resumes the same session on it.
    fireEvent.click(screen.getByText("Open with Kimi"));
    expect(onResumeSession).toHaveBeenCalledWith(
      "s-plain",
      "/tmp/proj",
      expect.stringContaining("Plain chat"),
      "kimi",
      "p1"
    );
    // The menu closes after picking.
    expect(screen.queryByText("Open with Kimi")).not.toBeInTheDocument();
  });

  it("plain Play launch passes no provider", () => {
    const onLaunchProject = vi.fn();
    renderSidebar({ onLaunchProject });
    fireEvent.click(screen.getByTitle("Launch 1 terminal"));
    expect(onLaunchProject).toHaveBeenCalledWith(project, undefined);
  });
});

describe("Sidebar", () => {
  it("shows the live terminal count next to the project name", () => {
    renderSidebar({ terminalCounts: new Map([["p1", 3]]) });
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("omits the count entirely when zero", () => {
    renderSidebar();
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
  });

  it("exposes the full project name as a native tooltip", () => {
    renderSidebar({
      projects: [{ ...project, name: "My Very Long Project Name" }],
    });
    expect(screen.getByTitle("My Very Long Project Name")).toBeInTheDocument();
  });

  it("fires onTogglePin from the pin button", () => {
    const onTogglePin = vi.fn();
    renderSidebar({ onTogglePin });
    fireEvent.click(screen.getByTitle(/pin sidebar/i));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });
});

describe("Sidebar context menu portal", () => {
  // The menu is portaled to document.body (rather than rendered inline)
  // because it sits inside SidebarReveal's flyout wrapper, which carries a
  // translate transform whenever the sidebar is unpinned — a transformed
  // ancestor becomes the containing block for `position: fixed` descendants,
  // which would otherwise mis-position this `fixed` menu relative to the
  // flyout instead of the viewport.
  it("renders the project context menu as a direct child of document.body", () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByText("proj"));
    const menuEl = screen.getByText("Edit project").closest(".glass-card");
    expect(menuEl).not.toBeNull();
    expect(menuEl?.parentElement).toBe(document.body);
  });

  it("still dismisses on an outside pointerdown once portaled", () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByText("proj"));
    expect(screen.getByText("Edit project")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("Edit project")).not.toBeInTheDocument();
  });
});

describe("Sidebar inside an unpinned SidebarReveal", () => {
  // The context menu portals to document.body, outside the flyout's DOM
  // subtree, so moving the pointer onto it fires the flyout's mouseLeave.
  // Without a hold, the flyout would slide shut underneath its own open menu.
  it("keeps the flyout open while the context menu is up, and closes once it's dismissed", () => {
    vi.useFakeTimers();
    try {
      render(
        <SidebarReveal pinned={false}>
          <Sidebar {...buildSidebarProps()} />
        </SidebarReveal>
      );
      const flyout = screen.getByTestId("sidebar-flyout");

      fireEvent.mouseEnter(screen.getByTestId("sidebar-hot-strip"), {
        buttons: 0,
      });
      expect(flyout.className).toContain("translate-x-0");

      fireEvent.contextMenu(screen.getByText("proj"));
      fireEvent.mouseLeave(flyout);
      expect(screen.getByText("Edit project")).toBeInTheDocument();

      // Past the close delay, the held flyout must still be open.
      act(() => vi.advanceTimersByTime(500));
      expect(flyout.className).toContain("translate-x-0");

      // Dismiss the menu; the flyout closes after the delay elapses again.
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByText("Edit project")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(300));
      expect(flyout.className).toContain("-translate-x-full");
    } finally {
      vi.useRealTimers();
    }
  });
});
