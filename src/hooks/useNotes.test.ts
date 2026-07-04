import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Mock the Tauri window label + ipc before importing the hook.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

const ipc = vi.hoisted(() => ({
  getWindowNotes: vi.fn(async () => [] as any[]),
  saveWindowNotes: vi.fn(async () => {}),
  removeNoteContent: vi.fn(async () => {}),
  removeWindowNotes: vi.fn(async () => {}),
  clearNotes: vi.fn(async () => {}),
}));
vi.mock("../lib/ipc", () => ipc);

import { useNotes } from "./useNotes";

beforeEach(() => {
  vi.clearAllMocks();
  ipc.getWindowNotes.mockResolvedValue([]);
});

describe("useNotes", () => {
  it("adds a note into the given workspace", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addNote("ws-1");
    });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].workspaceId).toBe("ws-1");
  });

  it("renames and removes notes", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let id = "";
    act(() => {
      id = result.current.addNote("ws-1").id;
    });
    act(() => result.current.renameNote(id, "Groceries"));
    expect(result.current.notes[0].label).toBe("Groceries");

    act(() => result.current.removeNote(id));
    expect(result.current.notes).toHaveLength(0);
    expect(ipc.removeNoteContent).toHaveBeenCalledWith(id);
  });

  it("reassigns notes from a deleted workspace to a fallback", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    act(() => {
      result.current.addNote("ws-doomed");
    });
    act(() => result.current.reassignNotes("ws-doomed", "ws-keep"));
    expect(result.current.notes[0].workspaceId).toBe("ws-keep");
  });

  it("moves a single note to another workspace, leaving others", async () => {
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(ipc.getWindowNotes).toHaveBeenCalled());

    let a = "";
    let b = "";
    act(() => {
      a = result.current.addNote("ws-1").id;
      b = result.current.addNote("ws-1").id;
    });
    act(() => result.current.moveNote(a, "ws-2"));

    const moved = result.current.notes.find((n) => n.id === a);
    const other = result.current.notes.find((n) => n.id === b);
    expect(moved?.workspaceId).toBe("ws-2");
    expect(other?.workspaceId).toBe("ws-1");
  });

  it("restores notes loaded from disk", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
    ]);
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.notes[0]).toEqual({
      id: "n-1",
      label: "Todo",
      color: "#abc",
      workspaceId: "ws-9",
    });
  });

  it("does not persist before the initial load completes", async () => {
    let resolveLoad: (v: any[]) => void = () => {};
    ipc.getWindowNotes.mockReturnValue(
      new Promise((r) => (resolveLoad = r)) as any
    );
    renderHook(() => useNotes());
    // Load hasn't resolved yet — the save effect must not have fired.
    expect(ipc.saveWindowNotes).not.toHaveBeenCalled();
    await act(async () => resolveLoad([]));
  });

  it("discardNotes clears state and files", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "Todo", color: "#abc", workspace_id: "ws-9" },
    ]);
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    await act(async () => {
      await result.current.discardNotes();
    });
    expect(result.current.notes).toHaveLength(0);
    expect(ipc.clearNotes).toHaveBeenCalled();
  });

  it("forgetWindowNotes deletes each note's content + this window's file, without re-saving", async () => {
    ipc.getWindowNotes.mockResolvedValue([
      { id: "n-1", label: "A", color: "#abc", workspace_id: "ws-1" },
      { id: "n-2", label: "B", color: "#abc", workspace_id: "ws-1" },
    ]);
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.notes).toHaveLength(2));
    ipc.saveWindowNotes.mockClear();

    await act(async () => {
      await result.current.forgetWindowNotes();
    });

    // Every note's durable content file is deleted.
    expect(ipc.removeNoteContent).toHaveBeenCalledWith("n-1");
    expect(ipc.removeNoteContent).toHaveBeenCalledWith("n-2");
    // This window's pane-list file is removed (label from the mocked window).
    expect(ipc.removeWindowNotes).toHaveBeenCalledWith("main");
    // Local state cleared, and the closing guard prevented a re-save that would
    // resurrect the file we just removed.
    expect(result.current.notes).toHaveLength(0);
    expect(ipc.saveWindowNotes).not.toHaveBeenCalled();
  });
});
