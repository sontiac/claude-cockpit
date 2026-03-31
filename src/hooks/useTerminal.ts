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

export function useTerminal({ id, onStatusChange, onExit, onRenameDetected }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const mount = useCallback(
    (container: HTMLDivElement) => {
      if (termRef.current) return;

      containerRef.current = container;

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

      // Try WebGL renderer
      try {
        const webglAddon = new WebglAddon();
        term.loadAddon(webglAddon);
      } catch {
        // WebGL not available, canvas fallback
      }

      term.onData((data) => {
        ptyWrite(id, data).catch(console.error);
      });

      term.onResize(({ cols, rows }) => {
        ptyResize(id, cols, rows).catch(console.error);
      });

      termRef.current = term;
      fitRef.current = fitAddon;

      // Listen for output from PTY
      let renameBuf = "";
      const unlistenOutput = onTerminalOutput(id, (data) => {
        const bytes = new Uint8Array(data);
        term.write(bytes);

        if (onRenameDetected) {
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
              onRenameDetected(newName);
              renameBuf = "";
            }
          }
        }
      });

      const unlistenStatus = onTerminalStatus(id, (status) => {
        onStatusChange?.(status as TerminalStatus);
      });

      const unlistenExit = onTerminalExit(id, (code) => {
        onExit?.(code);
      });

      // Only refit on actual window resizes — NOT on grid layout changes,
      // focus changes, or visibility changes. This is the only thing that
      // should trigger a resize on already-mounted terminals.
      const handleWindowResize = () => {
        scrollSafeFit(fitAddon, container);
      };
      window.addEventListener("resize", handleWindowResize);

      // Initial resize to tell PTY our actual size
      setTimeout(() => {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ptyResize(id, dims.cols, dims.rows).catch(console.error);
        }
      }, 50);

      return () => {
        window.removeEventListener("resize", handleWindowResize);
        Promise.all([unlistenOutput, unlistenStatus, unlistenExit]).then(
          (fns) => fns.forEach((fn) => fn())
        );
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    },
    [id, onStatusChange, onExit, onRenameDetected]
  );

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  // Scroll-safe refit that can be called externally (e.g. after grid layout change)
  const refit = useCallback(() => {
    if (fitRef.current && containerRef.current) {
      scrollSafeFit(fitRef.current, containerRef.current);
    }
  }, []);

  return { mount, focus, refit, termRef };
}
