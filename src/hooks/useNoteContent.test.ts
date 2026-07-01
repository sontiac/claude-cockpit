import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const ipc = vi.hoisted(() => ({
  getNoteContent: vi.fn(async () => null as unknown),
  saveNoteContent: vi.fn(async () => {}),
}));
vi.mock("../lib/ipc", () => ipc);

import { useNoteContent } from "./useNoteContent";

beforeEach(() => {
  vi.clearAllMocks();
  ipc.getNoteContent.mockResolvedValue(null);
});

describe("useNoteContent", () => {
  it("loads initial content for the id", async () => {
    const doc = { type: "doc", content: [] };
    ipc.getNoteContent.mockResolvedValue(doc);
    const { result } = renderHook(() => useNoteContent("n-1"));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(ipc.getNoteContent).toHaveBeenCalledWith("n-1");
    expect(result.current.initialContent).toEqual(doc);
  });

  it("coalesces rapid edits into a single debounced save", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNoteContent("n-1"));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync(); // let load resolve
    });

    act(() => result.current.onChange({ v: 1 }));
    act(() => result.current.onChange({ v: 2 }));
    act(() => result.current.onChange({ v: 3 }));
    expect(ipc.saveNoteContent).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(ipc.saveNoteContent).toHaveBeenCalledTimes(1);
    expect(ipc.saveNoteContent).toHaveBeenCalledWith("n-1", { v: 3 });
    vi.useRealTimers();
  });

  it("flushes a pending save on unmount", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useNoteContent("n-1"));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    act(() => result.current.onChange({ v: 42 }));
    unmount();
    expect(ipc.saveNoteContent).toHaveBeenCalledWith("n-1", { v: 42 });
    vi.useRealTimers();
  });

  it("saves a null content edit (emptied note) instead of silently dropping it", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNoteContent("n-1"));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync(); // let load resolve
    });

    act(() => result.current.onChange(null));
    expect(ipc.saveNoteContent).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(ipc.saveNoteContent).toHaveBeenCalledTimes(1);
    expect(ipc.saveNoteContent).toHaveBeenCalledWith("n-1", null);
    vi.useRealTimers();
  });
});
