import { useState, useEffect, useCallback, useRef } from "react";

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

/**
 * Manages free-form canvas geometry (position + size) for a set of terminals,
 * keyed by terminal id.
 *
 * While the canvas is *pristine* — the user has never moved, resized, or
 * arranged a pane on it — membership changes re-tile everything into
 * full-height columns fitting the surface (the "fit all" preset). Session
 * restore spawns panes one at a time, so this is what makes a reopened
 * workspace land as tidy columns; it also means panes added to an untouched
 * canvas keep it tiled. After the first manual adjustment, new ids are seeded
 * into a loose grid so a just-spawned terminal lands in a sensible,
 * non-overlapping spot without disturbing the user's layout; ids that
 * disappear are pruned. Geometry lives in memory for the session — terminal
 * ids are regenerated on each app launch, so there is nothing stable to
 * persist against yet (cross-restart layout persistence would need geometry
 * threaded through the workspace snapshot, which is a separate change).
 */
export function useCanvasLayout(
  ids: string[],
  getSurfaceSize?: () => { w: number; h: number } | null
) {
  const [layout, setLayout] = useState<Record<string, Rect>>({});

  // Read through a ref so the seeding effect depends only on `ids` — the
  // getter is a fresh closure every render.
  const getSurfaceSizeRef = useRef(getSurfaceSize);
  getSurfaceSizeRef.current = getSurfaceSize;

  // True until the user drags, resizes, or arranges — the auto-tiling gate.
  const pristineRef = useRef(true);

  useEffect(() => {
    setLayout((prev) => {
      // Only replace state if membership actually changed, so unrelated
      // re-renders don't churn object identity.
      const sameKeys =
        Object.keys(prev).length === ids.length && ids.every((id) => prev[id]);
      if (sameKeys) return prev;

      if (pristineRef.current) {
        const size = getSurfaceSizeRef.current?.() ?? null;
        if (size && size.w > 0 && size.h > 0) {
          return tileRects(ids, ids.length, size.w, size.h);
        }
      }

      const next: Record<string, Rect> = {};
      let seedCount = Object.keys(prev).length;
      for (const id of ids) {
        next[id] = prev[id] ?? seedRect(seedCount++);
      }
      return next;
    });
  }, [ids]);

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
