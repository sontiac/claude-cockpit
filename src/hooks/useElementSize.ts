import { useState, useEffect } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks an element's content-box size via ResizeObserver. Takes the element
 * itself (hold it in state via a callback ref) rather than a RefObject, so
 * observation survives the element unmounting and remounting — a RefObject
 * mutation doesn't re-run effects, which would leave a stale observer.
 * Returns {0, 0} until the first measurement lands — callers should treat
 * that as "size unknown" (e.g. render the default layout), never as "tiny".
 */
export function useElementSize(el: HTMLElement | null): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    if (!el) {
      setSize({ width: 0, height: 0 });
      return;
    }
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
  }, [el]);

  return size;
}
