import { useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  ptyWrite,
  ptyResize,
  onTerminalOutput,
  onTerminalStatus,
  onTerminalExit,
} from "../lib/ipc";
import type { TerminalStatus } from "../types/terminal";

interface UseTerminalOptions {
  id: string;
  onStatusChange?: (status: TerminalStatus) => void;
  onExit?: (code: number | null) => void;
  onRenameDetected?: (newName: string) => void;
}

/**
 * Calls fitAddon.fit() while preserving the xterm viewport's scroll position.
 * Temporarily sets overflow to hidden so the browser can't adjust scrollTop
 * during the resize, then immediately restores both overflow and scrollTop.
 */
function scrollSafeFit(fitAddon: FitAddon, container: HTMLElement) {
  const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
  if (!viewport) {
    fitAddon.fit();
    return;
  }

  const scrollTop = viewport.scrollTop;
  // Lock scroll during fit by hiding overflow
  viewport.style.overflowY = "hidden";
  fitAddon.fit();
  // Restore immediately
  viewport.scrollTop = scrollTop;
  viewport.style.overflowY = "";
}

/**
 * Probes whether a WebGL2 rendering context can be created right now. During
 * app/webview cold boot the WKWebView GPU process may not be ready yet, so
 * getContext('webgl2') returns null until it is. The probe context is released
 * immediately so it never holds onto a context slot.
 */
function webgl2Available(): boolean {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) return false;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}

/**
 * Creates a WebglAddon, wires context-loss handling (dispose → revert to DOM
 * rather than freeze), and loads it into the terminal. Returns the addon, or
 * null if activation threw (caller falls back to the DOM renderer).
 */
function loadWebglAddon(term: Terminal, id: string): WebglAddon | null {
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      console.warn(`[cockpit][${id}] WebGL context lost — reverting to DOM renderer`);
      addon.dispose();
    });
    term.loadAddon(addon);
    return addon;
  } catch (err) {
    console.warn(`[cockpit][${id}] WebGL addon load failed; using DOM renderer:`, err);
    return null;
  }
}

/**
 * The first WebGL context created in a freshly-launched WKWebView lands on a
 * degraded compositing path — scroll is janky despite WebGL being active and
 * correctly sized. Reopening the terminal (a fresh context, created after the
 * webview has settled) is the known cure. We reproduce that cure automatically
 * for the first terminal mounted in each app session.
 */
let firstTerminalMountedThisSession = false;

/**
 * How long to wait after the first terminal mounts before recreating its WebGL
 * context. The recreated context must be created *after* the webview has
 * finished its initial compositing, otherwise it inherits the same slow path.
 * Empirically the webview is settled well within this window; the only cost of
 * being generous is that the first terminal scrolls on its original (possibly
 * janky) context for this brief interval before going smooth.
 */
const FIRST_CONTEXT_SETTLE_MS = 1000;

export function useTerminal({ id, onStatusChange, onExit, onRenameDetected }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);

  // Keep the latest callbacks in a ref so `mount` can depend only on `id` and
  // stay referentially stable. Parents pass fresh inline callbacks on every
  // render (e.g. TerminalGrid's `(status) => onStatusChange(terminal.id, ...)`),
  // so a `mount` that closed over them directly would change identity each
  // render and tear down + recreate the terminal. Reading through the ref means
  // the live terminal always invokes the current callbacks without remounting.
  const callbacksRef = useRef({ onStatusChange, onExit, onRenameDetected });
  callbacksRef.current = { onStatusChange, onExit, onRenameDetected };

  const mount = useCallback(
    (container: HTMLDivElement) => {
      if (termRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
        lineHeight: 1.2,
        scrollback: 10000,
        theme: {
          background: "#0f172a",
          foreground: "#f1f5f9",
          cursor: "#06b6d4",
          selectionBackground: "rgba(6, 182, 212, 0.3)",
          black: "#1e293b",
          red: "#ef4444",
          green: "#10b981",
          yellow: "#f59e0b",
          blue: "#3b82f6",
          magenta: "#8b5cf6",
          cyan: "#06b6d4",
          white: "#f1f5f9",
          brightBlack: "#475569",
          brightRed: "#f87171",
          brightGreen: "#34d399",
          brightYellow: "#fbbf24",
          brightBlue: "#60a5fa",
          brightMagenta: "#a78bfa",
          brightCyan: "#22d3ee",
          brightWhite: "#ffffff",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(container);
      fitAddon.fit();

      // Attach xterm's WebGL renderer. Two cold-boot problems are handled here:
      //
      //   1. Genuine fallback — at cold boot getContext('webgl2') can briefly
      //      return null; xterm throws inside loadAddon and silently drops to the
      //      slow DOM renderer. We probe for a live context across a bounded
      //      number of frames before giving up. Probing first (vs catching a
      //      failed loadAddon) matters: xterm registers an addon *before* calling
      //      activate(), so a throwing activate() leaks a dead addon entry.
      //
      //   2. Degraded first context — even when WebGL loads fine, the *first*
      //      WebGL context in a freshly-launched webview lands on a slow
      //      compositing path (janky scroll) despite being active and correctly
      //      sized. Reopening the terminal is the known cure, so we recreate the
      //      first terminal's context once after the webview settles.
      let disposed = false;
      let webglRaf = 0;
      let settleTimer = 0;
      let webglAddon: WebglAddon | null = null;
      const MAX_WEBGL_FRAMES = 60; // ~1s at 60fps — ample headroom for cold boot
      let webglFrames = 0;
      const attachWebgl = () => {
        webglRaf = 0;
        if (disposed) return; // terminal torn down before the GPU was ready
        if (!webgl2Available()) {
          if (++webglFrames >= MAX_WEBGL_FRAMES) {
            console.warn(`[cockpit][${id}] WebGL2 unavailable after ${webglFrames} frames; using DOM renderer`);
            return;
          }
          webglRaf = requestAnimationFrame(attachWebgl);
          return;
        }

        webglAddon = loadWebglAddon(term, id);

        // Recreate the first terminal's context once after the webview settles
        // (see note 2 above). Only the first terminal per session is affected;
        // the swap is a single brief renderer flip and preserves screen content.
        if (webglAddon && !firstTerminalMountedThisSession) {
          firstTerminalMountedThisSession = true;
          settleTimer = window.setTimeout(() => {
            settleTimer = 0;
            if (disposed || !webglAddon) return;
            webglAddon.dispose();
            webglAddon = loadWebglAddon(term, id);
          }, FIRST_CONTEXT_SETTLE_MS);
        }
      };
      attachWebgl();

      term.onData((data) => {
        ptyWrite(id, data).catch(console.error);
      });

      term.onResize(({ cols, rows }) => {
        ptyResize(id, cols, rows).catch(console.error);
      });

      termRef.current = term;

      // Listen for output from PTY
      let renameBuf = "";
      const unlistenOutput = onTerminalOutput(id, (data) => {
        const bytes = new Uint8Array(data);
        term.write(bytes);

        if (callbacksRef.current.onRenameDetected) {
          const text = new TextDecoder().decode(bytes);
          renameBuf += text;
          if (renameBuf.length > 200) {
            renameBuf = renameBuf.slice(-200);
          }
          const clean = renameBuf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
          const match = clean.match(/Session renamed to:\s*(.+)/);
          if (match) {
            const newName = match[1].trim();
            if (newName) {
              callbacksRef.current.onRenameDetected(newName);
              renameBuf = "";
            }
          }
        }
      });

      const unlistenStatus = onTerminalStatus(id, (status) => {
        callbacksRef.current.onStatusChange?.(status as TerminalStatus);
      });

      const unlistenExit = onTerminalExit(id, (code) => {
        callbacksRef.current.onExit?.(code);
      });

      // Refit whenever the container's actual size changes — this covers
      // window resizes, grid layout switches (1→2→3→4), pane drags, and
      // sidebar toggles alike. Observing the element directly (instead of the
      // window 'resize' event) is what makes layout changes resize correctly,
      // since changing the grid template doesn't fire a window resize.
      // rAF-batched to coalesce bursts and avoid ResizeObserver loop errors.
      let rafId = 0;
      const applyFit = () => {
        rafId = 0;
        // Skip while the container is collapsed/hidden — fitting at 0px yields
        // 0 cols and corrupts the terminal (the zero-width-terminal bug).
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
        scrollSafeFit(fitAddon, container);
        const dims = fitAddon.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0) {
          ptyResize(id, dims.cols, dims.rows).catch(console.error);
        }
      };
      const scheduleFit = () => {
        if (rafId === 0) rafId = requestAnimationFrame(applyFit);
      };
      // Fires once on observe() with the initial size, which also handles the
      // first PTY size sync.
      const resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(container);

      return () => {
        disposed = true;
        if (webglRaf !== 0) cancelAnimationFrame(webglRaf);
        if (settleTimer !== 0) clearTimeout(settleTimer);
        if (rafId !== 0) cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        Promise.all([unlistenOutput, unlistenStatus, unlistenExit]).then(
          (fns) => fns.forEach((fn) => fn())
        );
        term.dispose();
        termRef.current = null;
      };
    },
    [id]
  );

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  return { mount, focus, termRef };
}
