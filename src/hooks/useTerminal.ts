import { useRef, useCallback, useEffect } from "react";
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
  fontSize: number;
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

/**
 * Extracts the session name from a terminal title set by Claude. Claude prefixes
 * the title with a status glyph — a braille spinner while working (U+2800–28FF)
 * or a sparkle when idle (✳ ✶ ✻ ✽, in the dingbats/symbols blocks) — followed by
 * a space. We strip any leading run of those glyphs, asterisks, and whitespace
 * so the returned name changes only when the actual session name does.
 */
function sessionNameFromTitle(title: string): string {
  return title.replace(/^[\s*☀-➿⠀-⣿️]+/, "").trim();
}

export function useTerminal({ id, fontSize, onStatusChange, onExit, onRenameDetected }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);

  // The fit addon and container are created inside `mount` but also need to be
  // reachable from the font-size effect below, which reflows the terminal after
  // changing the size. Holding them in refs keeps `mount` stable (depends only
  // on `id`) while still exposing what the effect needs.
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerElRef = useRef<HTMLElement | null>(null);

  // Initial font size for `new Terminal(...)`. Read through a ref so `mount`
  // doesn't depend on `fontSize` — otherwise every zoom would tear down and
  // recreate the terminal. Live changes are applied by the effect below.
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

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
        fontSize: fontSizeRef.current,
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
      fitAddonRef.current = fitAddon;
      containerElRef.current = container;

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

      // Track the current session name from the terminal title. Claude sets the
      // title to "<status glyph> <session name>", so stripping the glyph gives a
      // clean name. We only *read* it here — the title alone can't tell a manual
      // /rename from Claude's auto-generated title updates, so we don't act on it
      // directly (that would make the tab churn and overwrite a real rename).
      let lastTitleName = "";
      term.onTitleChange((title) => {
        lastTitleName = sessionNameFromTitle(title);
      });

      termRef.current = term;

      // Listen for output from PTY. We also watch the stream for Claude's
      // "Session renamed to:" confirmation — the one reliable signal that the
      // user actually ran /rename (vs an automatic title update). Claude paints
      // that line with cursor positioning, so the spaces are gone in the bytes
      // ("Sessionrenamedto:"); the regex tolerates that. On a real rename we
      // take the clean name from the title (read on the next frame, after xterm
      // has processed the title escape) and report it once.
      let outBuf = "";
      const unlistenOutput = onTerminalOutput(id, (data) => {
        const bytes = new Uint8Array(data);
        term.write(bytes);

        outBuf = (outBuf + new TextDecoder().decode(bytes)).slice(-400);
        const clean = outBuf.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        if (/session\s*renamed\s*to:/i.test(clean)) {
          outBuf = "";
          requestAnimationFrame(() => {
            if (disposed) return;
            if (lastTitleName) callbacksRef.current.onRenameDetected?.(lastTitleName);
          });
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
        fitAddonRef.current = null;
        containerElRef.current = null;
      };
    },
    [id]
  );

  // Apply font-size changes to the live terminal and reflow to the new cell
  // metrics, syncing the PTY to the new col/row count. No-ops before the
  // terminal mounts (the refs are null) and at the original size, so this never
  // recreates the terminal — it just resizes the existing one.
  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    const container = containerElRef.current;
    if (!term || !fitAddon || !container) return;
    term.options.fontSize = fontSize;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    scrollSafeFit(fitAddon, container);
    const dims = fitAddon.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0) {
      ptyResize(id, dims.cols, dims.rows).catch(console.error);
    }
  }, [fontSize, id]);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  return { mount, focus, termRef };
}
