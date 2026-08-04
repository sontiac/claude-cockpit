import type { Geometry } from "../types/terminal";

/**
 * Convert a physical-pixel position + size (what Tauri's window APIs report)
 * into a logical-point frame using the window's current scale factor.
 *
 * Window frames are persisted in logical points because physical pixels are
 * ambiguous on mixed-DPI multi-monitor setups: the same physical numbers mean
 * different on-screen rectangles depending on which monitor's scale factor
 * converts them back. Logical points are the OS's own global coordinate space
 * and need no conversion at restore time.
 */
export function toLogicalFrame(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  scale: number
): Geometry {
  return {
    x: Math.round(pos.x / scale),
    y: Math.round(pos.y / scale),
    width: Math.round(size.width / scale),
    height: Math.round(size.height / scale),
  };
}
