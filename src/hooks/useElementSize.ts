import { useState, useEffect, type RefObject } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's content-box size via ResizeObserver. Returns {0, 0}
 * until the first measurement lands — callers should treat that as "size
 * unknown" (e.g. render the default layout), never as "tiny".
 */
export function useElementSize(
  ref: RefObject<HTMLElement | null>
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1].contentRect;
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
