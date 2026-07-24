import { useState, useEffect, useCallback, useRef } from "react";
import type { ElementSize } from "./useElementSize";

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

/** Which window edge (or corner) a resize gesture grabs. */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * The rect that results from dragging `edge` of `orig` by (dx, dy). East/south
 * edges change only the size; west/north edges move the origin and
 * counter-adjust the size so the opposite edge stays put. Size is clamped to
 * MIN_W/MIN_H and the origin never leaves the canvas (x, y >= 0).
 */
export function resizeRect(
  orig: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number
): Rect {
  const next = { ...orig };
  if (edge.includes("e")) {
    next.w = Math.max(MIN_W, orig.w + dx);
  }
  if (edge.includes("s")) {
    next.h = Math.max(MIN_H, orig.h + dy);
  }
  if (edge.includes("w")) {
    const shift = Math.max(Math.min(dx, orig.w - MIN_W), -orig.x);
    next.x = orig.x + shift;
    next.w = orig.w - shift;
  }
  if (edge.includes("n")) {
    const shift = Math.max(Math.min(dy, orig.h - MIN_H), -orig.y);
    next.y = orig.y + shift;
    next.h = orig.h - shift;
  }
  return next;
}

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
 *
 * Cells are clamped to MIN_W/MIN_H so tiled panes stay usable. When the viewport
 * is too small to fit the whole grid at that minimum, the grid overflows the
 * surface (which scrolls) rather than shrinking below the minimum — crucially,
 * position spacing uses the *same clamped* cell size as the width/height, so
 * clamped panes never overlap.
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

  const cellW = Math.max(
    MIN_W,
    (viewportW - 2 * MARGIN - (columns - 1) * GAP) / columns
  );
  const cellH = Math.max(
    MIN_H,
    (viewportH - 2 * MARGIN - (rows - 1) * GAP) / rows
  );

  const rects: Record<string, Rect> = {};
  ids.forEach((id, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    rects[id] = {
      x: MARGIN + col * (cellW + GAP),
      y: MARGIN + row * (cellH + GAP),
      w: cellW,
      h: cellH,
    };
  });
  return rects;
}

function sameRects(a: Record<string, Rect>, b: Record<string, Rect>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const r = a[k];
    const s = b[k];
    return s && r.x === s.x && r.y === s.y && r.w === s.w && r.h === s.h;
  });
}

/**
 * Manages free-form canvas geometry (position + size) for a set of terminals,
 * keyed by terminal id.
 *
 * While the canvas is *pristine* — the user has never moved, resized, or
 * arranged a pane on it — it always shows the "fit all" layout: full-height
 * columns filling the surface, re-tiled whenever panes come or go AND
 * whenever the surface resizes. Session restore spawns panes one at a time
 * into a window that may only get its real size afterwards (saved geometry,
 * a maximize), so both triggers are needed for a reopened workspace to land
 * as full-size columns. After the first manual adjustment, the layout is the
 * user's: new ids are seeded into a loose grid so a just-spawned terminal
 * lands in a sensible, non-overlapping spot without disturbing anything, and
 * surface resizes leave geometry alone; ids that disappear are pruned.
 * Geometry lives in memory for the session — terminal ids are regenerated on
 * each app launch, so there is nothing stable to persist against yet
 * (cross-restart layout persistence would need geometry threaded through the
 * workspace snapshot, which is a separate change).
 */
export function useCanvasLayout(ids: string[], surfaceSize: ElementSize) {
  const [layout, setLayout] = useState<Record<string, Rect>>({});

  // True until the user drags, resizes, or arranges — the auto-tiling gate.
  const pristineRef = useRef(true);

  const { width, height } = surfaceSize;
  useEffect(() => {
    setLayout((prev) => {
      const sameKeys =
        Object.keys(prev).length === ids.length && ids.every((id) => prev[id]);

      if (pristineRef.current && width > 0 && height > 0) {
        const next = tileRects(ids, ids.length, width, height);
        // Keep object identity stable when the tiling comes out unchanged, so
        // unrelated re-renders don't churn downstream memoization.
        return sameKeys && sameRects(next, prev) ? prev : next;
      }

      if (sameKeys) return prev;
      const next: Record<string, Rect> = {};
      let seedCount = Object.keys(prev).length;
      for (const id of ids) {
        next[id] = prev[id] ?? seedRect(seedCount++);
      }
      return next;
    });
  }, [ids, width, height]);

  const setRect = useCallback((id: string, rect: Rect) => {
    pristineRef.current = false;
    setLayout((prev) => ({ ...prev, [id]: rect }));
  }, []);

  // Replace the geometry of several windows at once (used by the arrange/tidy
  // presets). Ids not present in `rects` keep their current geometry.
  const setAll = useCallback((rects: Record<string, Rect>) => {
    pristineRef.current = false;
    setLayout((prev) => ({ ...prev, ...rects }));
  }, []);

  return { layout, setRect, setAll };
}
