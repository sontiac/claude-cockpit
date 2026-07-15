import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
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
    const ref = createRef<HTMLElement | null>();
    (ref as { current: HTMLElement | null }).current = document.createElement("div");
    const { result } = renderHook(() => useElementSize(ref));
    expect(result.current).toEqual({ width: 0, height: 0 });
    expect(observe).toHaveBeenCalledOnce();
  });

  it("reports the latest observed content size", () => {
    const ref = createRef<HTMLElement | null>();
    (ref as { current: HTMLElement | null }).current = document.createElement("div");
    const { result } = renderHook(() => useElementSize(ref));
    act(() => {
      lastCallback!([{ contentRect: { width: 300, height: 180 } }]);
    });
    expect(result.current).toEqual({ width: 300, height: 180 });
  });

  it("disconnects on unmount", () => {
    const ref = createRef<HTMLElement | null>();
    (ref as { current: HTMLElement | null }).current = document.createElement("div");
    const { unmount } = renderHook(() => useElementSize(ref));
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
