import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { tileRects, MIN_W, MIN_H, useCanvasLayout } from "./useCanvasLayout";

describe("tileRects columns preset (cols = n)", () => {
  it("lays every pane into a single full-height row", () => {
    const ids = ["a", "b", "c", "d"];
    const rects = tileRects(ids, ids.length, 1000, 600);

    // One row: every rect shares the same y (the top margin).
    const ys = ids.map((id) => rects[id].y);
    expect(new Set(ys).size).toBe(1);

    // x strictly increasing left-to-right.
    const xs = ids.map((id) => rects[id].x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }

    // Full-height columns: each rect is (near) the full viewport height, and at
    // least MIN_H.
    for (const id of ids) {
      expect(rects[id].h).toBeGreaterThanOrEqual(MIN_H);
      // 600 viewport minus top+bottom margins (20 each) = 560, single row.
      expect(rects[id].h).toBe(560);
    }
  });

  it("degenerates to a single full-viewport pane for one id", () => {
    const rects = tileRects(["only"], 1, 800, 500);
    expect(rects["only"].y).toBe(20);
    expect(rects["only"].h).toBe(460); // 500 - 2*20
  });
});

describe("tileRects when the viewport is too small to fit every pane", () => {
  // With enough panes (e.g. several terminals plus a note), an ideal cell drops
  // below the MIN_W/MIN_H floor. Panes must still be clamped to the minimum AND
  // laid out without overlapping — position spacing has to match the clamped
  // size, not the pre-clamp ideal size.
  it("never overlaps horizontally when cells are clamped to MIN_W", () => {
    const ids = ["a", "b", "c", "d", "e"]; // 5 full-height columns...
    const rects = tileRects(ids, ids.length, 800, 600); // ...in only 800px wide

    for (const id of ids) {
      expect(rects[id].w).toBeGreaterThanOrEqual(MIN_W);
    }

    const cols = ids.map((id) => rects[id]).sort((a, b) => a.x - b.x);
    for (let i = 1; i < cols.length; i++) {
      // Each column starts at or after the previous column's right edge.
      expect(cols[i].x).toBeGreaterThanOrEqual(cols[i - 1].x + cols[i - 1].w);
    }
  });

  it("never overlaps vertically when cells are clamped to MIN_H", () => {
    const ids = ["a", "b", "c", "d", "e", "f"]; // 6 panes, 1 column, tall stack
    const rects = tileRects(ids, 1, 400, 300); // 300px tall can't fit 6 rows

    for (const id of ids) {
      expect(rects[id].h).toBeGreaterThanOrEqual(MIN_H);
    }

    const rows = ids.map((id) => rects[id]).sort((a, b) => a.y - b.y);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].h);
    }
  });
});

describe("pristine-canvas auto-tiling", () => {
  const surface = () => ({ w: 1000, h: 600 });

  it("seeds the first pane of an empty canvas to fill the surface", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, surface),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a"] });
    // tileRects([a], 1, 1000, 600): full surface minus margins.
    expect(result.current.layout["a"]).toEqual(
      tileRects(["a"], 1, 1000, 600)["a"]
    );
  });

  it("tiles panes arriving one by one into full-height columns", () => {
    // Session restore spawns terminals sequentially — each arrival re-tiles
    // the whole canvas while it's untouched, so a restored workspace lands as
    // full-height columns, not a staggered pile.
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, surface),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a"] });
    rerender({ ids: ["a", "b"] });
    rerender({ ids: ["a", "b", "c"] });
    expect(result.current.layout).toEqual(
      tileRects(["a", "b", "c"], 3, 1000, 600)
    );
  });

  it("tiles a batch arriving at once into full-height columns", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, surface),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a", "b"] });
    expect(result.current.layout).toEqual(tileRects(["a", "b"], 2, 1000, 600));
  });

  it("stops auto-tiling once a pane is manually moved or resized", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, surface),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a", "b"] });
    const moved = { x: 40, y: 40, w: 300, h: 200 };
    act(() => result.current.setRect("a", moved));
    rerender({ ids: ["a", "b", "c"] });
    // The hand-placed pane keeps its rect; the newcomer staggers instead of
    // re-tiling everything.
    expect(result.current.layout["a"]).toEqual(moved);
    expect(result.current.layout["c"].w).toBe(520);
    expect(result.current.layout["c"].h).toBe(340);
  });

  it("stops auto-tiling once an arrange preset has been applied", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, surface),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a", "b"] });
    act(() => result.current.setAll(tileRects(["a", "b"], 1, 1000, 600)));
    rerender({ ids: ["a", "b", "c"] });
    expect(result.current.layout["c"].w).toBe(520);
  });

  it("re-tiles the remaining panes when one closes while untouched", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, surface),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a", "b", "c"] });
    rerender({ ids: ["a", "b"] });
    expect(result.current.layout).toEqual(tileRects(["a", "b"], 2, 1000, 600));
  });

  it("falls back to the staggered seed when the surface size is unknown", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCanvasLayout(ids, () => null),
      { initialProps: { ids: [] as string[] } }
    );
    rerender({ ids: ["a"] });
    expect(result.current.layout["a"].w).toBe(520);
  });
});
