import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConfirm } from "./useConfirm";
import type { ConfirmSpec } from "../types/confirm";

const spec: ConfirmSpec = {
  title: "Delete it?",
  body: "It will be gone.",
  confirmLabel: "Delete",
};

describe("useConfirm", () => {
  it("starts with no pending spec", () => {
    const { result } = renderHook(() => useConfirm());
    expect(result.current.spec).toBeNull();
  });

  it("exposes the spec while pending, resolves true on respond(true), then clears", async () => {
    const { result } = renderHook(() => useConfirm());
    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.confirm(spec);
    });
    expect(result.current.spec).toEqual(spec);

    act(() => result.current.respond(true));
    await expect(answer!).resolves.toBe(true);
    expect(result.current.spec).toBeNull();
  });

  it("resolves false on respond(false)", async () => {
    const { result } = renderHook(() => useConfirm());
    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.confirm(spec);
    });
    act(() => result.current.respond(false));
    await expect(answer!).resolves.toBe(false);
  });

  it("a newer request supersedes an unanswered one, cancelling it", async () => {
    const { result } = renderHook(() => useConfirm());
    const second: ConfirmSpec = { ...spec, title: "Second?" };
    let first: Promise<boolean>;
    let next: Promise<boolean>;
    act(() => {
      first = result.current.confirm(spec);
    });
    act(() => {
      next = result.current.confirm(second);
    });
    await expect(first!).resolves.toBe(false);
    expect(result.current.spec).toEqual(second);

    act(() => result.current.respond(true));
    await expect(next!).resolves.toBe(true);
  });

  it("respond without a pending confirm is a no-op", () => {
    const { result } = renderHook(() => useConfirm());
    act(() => result.current.respond(true));
    expect(result.current.spec).toBeNull();
  });
});
