import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const ipc = vi.hoisted(() => ({
  readTextFile: vi.fn(async () => ({ content: "# one", mtime_ms: 100 })),
  statFile: vi.fn(async () => 100),
}));
vi.mock("../lib/ipc", () => ipc);

import { useMarkdownFile } from "./useMarkdownFile";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ipc.readTextFile.mockResolvedValue({ content: "# one", mtime_ms: 100 });
  ipc.statFile.mockResolvedValue(100);
});

afterEach(() => {
  vi.useRealTimers();
});

const flush = async () => {
  // Let pending promises settle under fake timers.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useMarkdownFile", () => {
  it("does nothing for a null path", async () => {
    const { result } = renderHook(() => useMarkdownFile(null));
    await flush();
    expect(ipc.readTextFile).not.toHaveBeenCalled();
    expect(result.current).toEqual({ content: null, error: null });
  });

  it("loads the file on mount", async () => {
    const { result } = renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();
    expect(ipc.readTextFile).toHaveBeenCalledWith("/tmp/plan.md");
    expect(result.current).toEqual({ content: "# one", error: null });
  });

  it("does not re-read while the mtime is unchanged", async () => {
    renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(ipc.statFile).toHaveBeenCalled();
    expect(ipc.readTextFile).toHaveBeenCalledTimes(1);
  });

  it("re-reads when the mtime changes", async () => {
    const { result } = renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();

    ipc.statFile.mockResolvedValue(200);
    ipc.readTextFile.mockResolvedValue({ content: "# two", mtime_ms: 200 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(ipc.readTextFile).toHaveBeenCalledTimes(2);
    expect(result.current.content).toBe("# two");
  });

  it("exposes read errors and keeps the last content, then recovers", async () => {
    const { result } = renderHook(() => useMarkdownFile("/tmp/plan.md"));
    await flush();

    ipc.statFile.mockRejectedValue(new Error("gone"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.content).toBe("# one");
    expect(result.current.error).toContain("gone");

    ipc.statFile.mockResolvedValue(300);
    ipc.readTextFile.mockResolvedValue({ content: "# back", mtime_ms: 300 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current).toEqual({ content: "# back", error: null });
  });

  it("surfaces an initial load failure as an error with no content", async () => {
    ipc.readTextFile.mockRejectedValue(new Error("No such file"));
    const { result } = renderHook(() => useMarkdownFile("/tmp/missing.md"));
    await flush();
    expect(result.current.content).toBeNull();
    expect(result.current.error).toContain("No such file");
  });
});
