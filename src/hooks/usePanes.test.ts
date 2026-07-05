import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Mock the Tauri window label + ipc before importing the hook.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

const ipc = vi.hoisted(() => ({
  getWindowNotes: vi.fn(async () => [] as any[]),
  // Typed with the real params (unused here) so `.mock.calls` carries the
  // real call shape — the assertions below index into call arguments.
  saveWindowNotes: vi.fn(async (_label: string, _notes: unknown[]) => {}),
  removeNoteContent: vi.fn(async () => {}),
  removeWindowNotes: vi.fn(async () => {}),
  clearNotes: vi.fn(async () => {}),
}));
vi.mock("../lib/ipc", () => ipc);

import { usePanes } from "./usePanes";

beforeEach(() => {
  vi.clearAllMocks();
  ipc.getWindowNotes.mockResolvedValue([]);
});

describe("usePanes", () => {
  it("adds a note into the given workspace", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addPane("note", "ws-1");
    });
    expect(result.current.panes).toHaveLength(1);
    expect(result.current.panes[0]).toMatchObject({ kind: "note", workspaceId: "ws-1" });
  });

  it("adds mdviewer and pomodoro panes with per-kind defaults", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addPane("mdviewer", "ws-1");
      result.current.addPane("pomodoro", "ws-1");
    });
    expect(result.current.panes[0]).toMatchObject({ kind: "mdviewer", path: null, label: "Plan" });
    expect(result.current.panes[1]).toMatchObject({
      kind: "pomodoro",
      workMinutes: 25,
      breakMinutes: 5,
      label: "Pomodoro",
    });
  });

  it("renames and removes panes (note removal deletes its content file)", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addPane("note", "ws-1").id;
    });
    act(() => result.current.renamePane(id, "Groceries"));
    expect(result.current.panes[0].label).toBe("Groceries");

    act(() => result.current.removePane(id));
    expect(result.current.panes).toHaveLength(0);
    expect(ipc.removeNoteContent).toHaveBeenCalledWith(id);
  });

  it("reassigns panes from a deleted workspace to a fallback", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addPane("note", "ws-doomed");
    });
    act(() => result.current.reassignPanes("ws-doomed", "ws-keep"));
    expect(result.current.panes[0].workspaceId).toBe("ws-keep");
  });

  it("moves a single pane to another workspace, leaving others", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let a = "";
    let b = "";
    act(() => {
      a = result.current.addPane("note", "ws-1").id;
      b = result.current.addPane("note", "ws-1").id;
    });
    act(() => result.current.movePane(a, "ws-2"));

    const moved = result.current.panes.find((p) => p.id === a);
    const other = result.current.panes.find((p) => p.id === b);
    expect(moved?.workspaceId).toBe("ws-2");
    expect(other?.workspaceId).toBe("ws-1");
  });

  it("restores panes loaded from disk, defaulting missing kind to note", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
      {
        id: "v-1",
        label: "Plan",
        color: "#0af",
        workspace_id: "ws-9",
        kind: "mdviewer",
        path: "/tmp/plan.md",
      },
      {
        id: "p-1",
        label: "Pomodoro",
        color: "#f80",
        workspace_id: "ws-9",
        kind: "pomodoro",
        work_minutes: 50,
        break_minutes: 10,
      },
    ]);
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(result.current.panes).toHaveLength(3));
    expect(result.current.panes[0]).toEqual({
      id: "n-1",
      label: "Todo",
      color: "#abc",
      workspaceId: "ws-9",
      kind: "note",
    });
    expect(result.current.panes[1]).toEqual({
      id: "v-1",
      label: "Plan",
      color: "#0af",
      workspaceId: "ws-9",
      kind: "mdviewer",
      path: "/tmp/plan.md",
    });
    expect(result.current.panes[2]).toEqual({
      id: "p-1",
      label: "Pomodoro",
      color: "#f80",
      workspaceId: "ws-9",
      kind: "pomodoro",
      workMinutes: 50,
      breakMinutes: 10,
    });
  });

  it("setPanePath updates the target mdviewer and persists it", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addPane("mdviewer", "ws-1").id;
    });
    act(() => result.current.setPanePath(id, "/tmp/plan.md"));

    const pane = result.current.panes[0];
    expect(pane.kind === "mdviewer" && pane.path).toBe("/tmp/plan.md");
    await waitFor(() => {
      const lastSave = ipc.saveWindowNotes.mock.calls.at(-1);
      expect(lastSave?.[1]).toEqual([expect.objectContaining({ path: "/tmp/plan.md" })]);
    });
  });

  it("setPomodoroDurations updates the target pomodoro", async () => {
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addPane("pomodoro", "ws-1").id;
    });
    act(() => result.current.setPomodoroDurations(id, 50, 10));
    expect(result.current.panes[0]).toMatchObject({ workMinutes: 50, breakMinutes: 10 });
  });

  it("does not persist before the initial load completes", async () => {
    let resolveLoad: (v: any[]) => void = () => {};
    ipc.getWindowNotes.mockReturnValue(new Promise((r) => (resolveLoad = r)) as any);
    renderHook(() => usePanes());
    expect(ipc.saveWindowNotes).not.toHaveBeenCalled();
    await act(async () => resolveLoad([]));
  });

  it("discardPanes clears state and files", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
    ]);
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(result.current.panes).toHaveLength(1));

    await act(async () => {
      await result.current.discardPanes();
    });
    expect(result.current.panes).toHaveLength(0);
    expect(ipc.clearNotes).toHaveBeenCalled();
  });

  it("forgetWindowPanes deletes note content + this window's file, without re-saving", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "A", color: "#abc", workspace_id: "ws-1" },
      { id: "n-2", label: "B", color: "#abc", workspace_id: "ws-1" },
    ]);
    const { result } = renderHook(() => usePanes());
    await waitFor(() => expect(result.current.panes).toHaveLength(2));
    ipc.saveWindowNotes.mockClear();

    await act(async () => {
      await result.current.forgetWindowPanes();
    });

    expect(ipc.removeNoteContent).toHaveBeenCalledWith("n-1");
    expect(ipc.removeNoteContent).toHaveBeenCalledWith("n-2");
    expect(ipc.removeWindowNotes).toHaveBeenCalledWith("main");
    expect(result.current.panes).toHaveLength(0);
    expect(ipc.saveWindowNotes).not.toHaveBeenCalled();
  });
});
