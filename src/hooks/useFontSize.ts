import { createContext, useCallback, useContext, useState } from "react";

// Terminal font size is a pure view preference, so it lives in localStorage
// rather than the Rust-backed workspace store. Reading it synchronously on the
// first render (vs. an async IPC fetch) is what avoids a visible font flash —
// terminals mount at the persisted size immediately instead of rendering at the
// default and reflowing once the size resolves.
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const DEFAULT_FONT_SIZE = 13;
const STEP = 1;
const STORAGE_KEY = "cockpit.fontSize";

function clamp(n: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, n));
}

function readStored(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? clamp(n) : DEFAULT_FONT_SIZE;
}

function persist(n: number): number {
  localStorage.setItem(STORAGE_KEY, String(n));
  return n;
}

export interface FontSizeController {
  fontSize: number;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
}

/**
 * Owns the terminal font size and its persistence. Used once, near the top of
 * the tree; the value is shared down via FontSizeContext and the setters are
 * wired to keyboard shortcuts and the status-bar controls.
 */
export function useFontSizeController(): FontSizeController {
  const [fontSize, setFontSize] = useState<number>(readStored);

  const increase = useCallback(() => {
    setFontSize((s) => persist(clamp(s + STEP)));
  }, []);
  const decrease = useCallback(() => {
    setFontSize((s) => persist(clamp(s - STEP)));
  }, []);
  const reset = useCallback(() => {
    setFontSize(() => persist(DEFAULT_FONT_SIZE));
  }, []);

  return { fontSize, increase, decrease, reset };
}

/** Current terminal font size, provided by the controller above. */
export const FontSizeContext = createContext<number>(DEFAULT_FONT_SIZE);

export function useFontSize(): number {
  return useContext(FontSizeContext);
}
