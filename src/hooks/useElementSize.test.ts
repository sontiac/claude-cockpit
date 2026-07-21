import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElementSize } from "./useElementSize";

type ROCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;

let lastCallback: ROCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();

class MockResizeObserver {
  constructor(cb: ROCallback) {
    lastCallback = cb;
  }
  observe = observe;
  disconnect = disconnect;
  unobserve = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  lastCallback = null;
  observe.mockClear();
  disconnect.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useElementSize", () => {
  it("returns 0x0 before the first measurement", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useElementSize(el));
    expect(result.current).toEqual({ width: 0, height: 0 });
    expect(observe).toHaveBeenCalledOnce();
  });

  it("does not observe until an element exists, then observes it", () => {
    const { rerender } = renderHook(({ el }) => useElementSize(el), {
      initialProps: { el: null as HTMLElement | null },
    });
    expect(observe).not.toHaveBeenCalled();
    rerender({ el: document.createElement("div") });
    expect(observe).toHaveBeenCalledOnce();
  });

  it("reports the latest observed content size", () => {
    const el = document.createElement("div");
    const { result } = renderHook(() => useElementSize(el));
    act(() => {
      lastCallback!([{ contentRect: { width: 300, height: 180 } }]);
    });
    expect(result.current).toEqual({ width: 300, height: 180 });
  });

  it("resets to 0x0 when the element unmounts", () => {
    const el = document.createElement("div");
    const { result, rerender } = renderHook(({ el }) => useElementSize(el), {
      initialProps: { el: el as HTMLElement | null },
    });
    act(() => {
      lastCallback!([{ contentRect: { width: 300, height: 180 } }]);
    });
    rerender({ el: null });
    expect(result.current).toEqual({ width: 0, height: 0 });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects on unmount", () => {
    const el = document.createElement("div");
    const { unmount } = renderHook(() => useElementSize(el));
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
