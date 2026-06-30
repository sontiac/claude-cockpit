import { useState, useEffect, useCallback } from "react";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Default size of a freshly-placed terminal on the canvas, and the gap used when
// auto-tiling new terminals so they don't all stack on the same spot.
const DEFAULT_W = 520;
const DEFAULT_H = 340;
const GAP = 20;
const MARGIN = 20;
const COLS = 3;

export const MIN_W = 240;
export const MIN_H = 140;

function seedRect(index: number): Rect {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    x: MARGIN + col * (DEFAULT_W + GAP),
    y: MARGIN + row * (DEFAULT_H + GAP),
    w: DEFAULT_W,
    h: DEFAULT_H,
  };
}

/**
 * Compute tiled geometry that arranges `ids` into a grid of `cols` columns
 * filling the given viewport (the canvas-surface client size). This is what the
 * arrange/tidy presets apply — windows snap into a neat grid but remain freely
 * draggable/resizable afterward. Pass `cols = 0` for an automatic square-ish
 * grid (ceil(sqrt(n)) columns).
 */
export function tileRects(
  ids: string[],
  cols: number,
  viewportW: number,
  viewportH: number
): Record<string, Rect> {
  const n = ids.length;
  if (n === 0) return {};

  const columns = Math.min(
    n,
    cols > 0 ? cols : Math.ceil(Math.sqrt(n))
  );
  const rows = Math.ceil(n / columns);

  const cellW = (viewportW - 2 * MARGIN - (columns - 1) * GAP) / columns;
  const cellH = (viewportH - 2 * MARGIN - (rows - 1) * GAP) / rows;

  const rects: Record<string, Rect> = {};
  ids.forEach((id, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    rects[id] = {
      x: MARGIN + col * (cellW + GAP),
      y: MARGIN + row * (cellH + GAP),
      w: Math.max(MIN_W, cellW),
      h: Math.max(MIN_H, cellH),
    };
  });
  return rects;
}

/**
 * Manages free-form canvas geometry (position + size) for a set of terminals,
 * keyed by terminal id.
 *
 * New ids are seeded into a loose grid so a just-spawned terminal lands in a
 * sensible, non-overlapping spot the user can then drag; ids that disappear are
 * pruned. Geometry lives in memory for the session — terminal ids are
 * regenerated on each app launch, so there is nothing stable to persist against
 * yet (cross-restart layout persistence would need geometry threaded through the
 * workspace snapshot, which is a separate change).
 */
export function useCanvasLayout(ids: string[]) {
  const [layout, setLayout] = useState<Record<string, Rect>>({});

  useEffect(() => {
    setLayout((prev) => {
      const next: Record<string, Rect> = {};
      let seedCount = Object.keys(prev).length;
      for (const id of ids) {
        next[id] = prev[id] ?? seedRect(seedCount++);
      }
      // Only replace state if membership actually changed, so unrelated
      // re-renders don't churn object identity.
      const sameKeys =
        Object.keys(next).length === Object.keys(prev).length &&
        ids.every((id) => prev[id]);
      return sameKeys ? prev : next;
    });
  }, [ids]);

  const setRect = useCallback((id: string, rect: Rect) => {
    setLayout((prev) => ({ ...prev, [id]: rect }));
  }, []);

  // Replace the geometry of several windows at once (used by the arrange/tidy
  // presets). Ids not present in `rects` keep their current geometry.
  const setAll = useCallback((rects: Record<string, Rect>) => {
    setLayout((prev) => ({ ...prev, ...rects }));
  }, []);

  return { layout, setRect, setAll };
}
