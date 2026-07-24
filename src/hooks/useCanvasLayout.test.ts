import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  tileRects,
  resizeRect,
  MIN_W,
  MIN_H,
  useCanvasLayout,
} from "./useCanvasLayout";

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
  const size = { width: 1000, height: 600 };

  function renderLayout(initialIds: string[] = []) {
    return renderHook(
      ({ ids, surface }: { ids: string[]; surface: typeof size }) =>
        useCanvasLayout(ids, surface),
      { initialProps: { ids: initialIds, surface: size } }
    );
  }

  it("seeds the first pane of an empty canvas to fill the surface", () => {
    const { result, rerender } = renderLayout();
    rerender({ ids: ["a"], surface: size });
    // tileRects([a], 1, 1000, 600): full surface minus margins.
    expect(result.current.layout["a"]).toEqual(
      tileRects(["a"], 1, 1000, 600)["a"]
    );
  });

  it("tiles panes arriving one by one into full-height columns", () => {
    // Session restore spawns terminals sequentially — each arrival re-tiles
    // the whole canvas while it's untouched, so a restored workspace lands as
    // full-height columns, not a staggered pile.
    const { result, rerender } = renderLayout();
    rerender({ ids: ["a"], surface: size });
    rerender({ ids: ["a", "b"], surface: size });
    rerender({ ids: ["a", "b", "c"], surface: size });
    expect(result.current.layout).toEqual(
      tileRects(["a", "b", "c"], 3, 1000, 600)
    );
  });

  it("re-tiles when the surface grows while untouched", () => {
    // The reopen sequence: panes restore while the window still has its
    // default size, THEN the saved geometry / a maximize lands. An untouched
    // canvas must follow the surface, or restored panes stay small.
    const { result, rerender } = renderLayout();
    rerender({ ids: ["a", "b"], surface: size });
    const grown = { width: 1600, height: 900 };
    rerender({ ids: ["a", "b"], surface: grown });
    expect(result.current.layout).toEqual(tileRects(["a", "b"], 2, 1600, 900));
  });

  it("does not re-tile on surface changes after a manual adjustment", () => {
    const { result, rerender } = renderLayout();
    rerender({ ids: ["a", "b"], surface: size });
    const moved = { x: 40, y: 40, w: 300, h: 200 };
    act(() => result.current.setRect("a", moved));
    rerender({ ids: ["a", "b"], surface: { width: 1600, height: 900 } });
    expect(result.current.layout["a"]).toEqual(moved);
  });

  it("stops auto-tiling once a pane is manually moved or resized", () => {
    const { result, rerender } = renderLayout();
    rerender({ ids: ["a", "b"], surface: size });
    const moved = { x: 40, y: 40, w: 300, h: 200 };
    act(() => result.current.setRect("a", moved));
    rerender({ ids: ["a", "b", "c"], surface: size });
    // The hand-placed pane keeps its rect; the newcomer staggers instead of
    // re-tiling everything.
    expect(result.current.layout["a"]).toEqual(moved);
    expect(result.current.layout["c"].w).toBe(520);
    expect(result.current.layout["c"].h).toBe(340);
  });

  it("stops auto-tiling once an arrange preset has been applied", () => {
    const { result, rerender } = renderLayout();
    rerender({ ids: ["a", "b"], surface: size });
    act(() => result.current.setAll(tileRects(["a", "b"], 1, 1000, 600)));
    rerender({ ids: ["a", "b", "c"], surface: size });
    expect(result.current.layout["c"].w).toBe(520);
  });

  it("re-tiles the remaining panes when one closes while untouched", () => {
    const { result, rerender } = renderLayout();
    rerender({ ids: ["a", "b", "c"], surface: size });
    rerender({ ids: ["a", "b"], surface: size });
    expect(result.current.layout).toEqual(tileRects(["a", "b"], 2, 1000, 600));
  });

  it("resizeRect grows/shrinks from each edge and corner", () => {
    const orig = { x: 100, y: 80, w: 400, h: 300 };
    // East/south move only the size.
    expect(resizeRect(orig, "e", 50, 999)).toEqual({ ...orig, w: 450 });
    expect(resizeRect(orig, "s", 999, 40)).toEqual({ ...orig, h: 340 });
    // West/north move the origin and counter-adjust the size.
    expect(resizeRect(orig, "w", -30, 999)).toEqual({ x: 70, y: 80, w: 430, h: 300 });
    expect(resizeRect(orig, "n", 999, -20)).toEqual({ x: 100, y: 60, w: 400, h: 320 });
    // Corners combine both axes.
    expect(resizeRect(orig, "se", 10, 20)).toEqual({ x: 100, y: 80, w: 410, h: 320 });
    expect(resizeRect(orig, "nw", -10, -20)).toEqual({ x: 90, y: 60, w: 410, h: 320 });
    expect(resizeRect(orig, "ne", 10, -20)).toEqual({ x: 100, y: 60, w: 410, h: 320 });
    expect(resizeRect(orig, "sw", -10, 20)).toEqual({ x: 90, y: 80, w: 410, h: 320 });
  });

  it("resizeRect clamps to the minimum size on every edge", () => {
    const orig = { x: 100, y: 80, w: 400, h: 300 };
    expect(resizeRect(orig, "e", -9999, 0).w).toBe(MIN_W);
    expect(resizeRect(orig, "s", 0, -9999).h).toBe(MIN_H);
    // Shrinking from the west/north stops the origin once the min is reached.
    expect(resizeRect(orig, "w", 9999, 0)).toEqual({
      x: 100 + (400 - MIN_W),
      y: 80,
      w: MIN_W,
      h: 300,
    });
    expect(resizeRect(orig, "n", 0, 9999)).toEqual({
      x: 100,
      y: 80 + (300 - MIN_H),
      w: 400,
      h: MIN_H,
    });
  });

  it("resizeRect never drags the origin past the canvas edge", () => {
    const orig = { x: 30, y: 10, w: 400, h: 300 };
    // Growing west/north stops at x=0/y=0, transferring only what's available.
    expect(resizeRect(orig, "w", -100, 0)).toEqual({ x: 0, y: 10, w: 430, h: 300 });
    expect(resizeRect(orig, "n", 0, -100)).toEqual({ x: 30, y: 0, w: 400, h: 310 });
  });

  it("seeds staggered while unmeasured, then tiles on first measurement", () => {
    // ResizeObserver delivers the first surface measurement asynchronously —
    // {0,0} means "unknown", and the first real size must re-tile.
    const unknown = { width: 0, height: 0 };
    const { result, rerender } = renderHook(
      ({ ids, surface }: { ids: string[]; surface: typeof size }) =>
        useCanvasLayout(ids, surface),
      { initialProps: { ids: [] as string[], surface: unknown } }
    );
    rerender({ ids: ["a"], surface: unknown });
    expect(result.current.layout["a"].w).toBe(520);
    rerender({ ids: ["a"], surface: size });
    expect(result.current.layout).toEqual(tileRects(["a"], 1, 1000, 600));
  });
});
