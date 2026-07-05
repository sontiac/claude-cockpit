import { describe, it, expect } from "vitest";
import { tileRects, MIN_W, MIN_H } from "./useCanvasLayout";

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
