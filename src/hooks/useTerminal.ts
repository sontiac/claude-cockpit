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
}

export function useTerminal({ id, onStatusChange, onExit }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const mount = useCallback(
    (container: HTMLDivElement) => {
      if (termRef.current) return; // Already mounted

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

      // Send input to PTY
      term.onData((data) => {
        ptyWrite(id, data).catch(console.error);
      });

      // Handle resize
      term.onResize(({ cols, rows }) => {
        ptyResize(id, cols, rows).catch(console.error);
      });

      termRef.current = term;
      fitRef.current = fitAddon;

      // Listen for output from PTY
      const unlistenOutput = onTerminalOutput(id, (data) => {
        const bytes = new Uint8Array(data);
        term.write(bytes);
      });

      // Listen for status changes
      const unlistenStatus = onTerminalStatus(id, (status) => {
        onStatusChange?.(status as TerminalStatus);
      });

      // Listen for exit
      const unlistenExit = onTerminalExit(id, (code) => {
        onExit?.(code);
      });

      // Resize on container size changes
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(container);

      // Initial resize to tell PTY our actual size after layout settles
      setTimeout(() => {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ptyResize(id, dims.cols, dims.rows).catch(console.error);
        }
      }, 50);

      // Cleanup
      return () => {
        resizeObserver.disconnect();
        Promise.all([unlistenOutput, unlistenStatus, unlistenExit]).then(
          (fns) => fns.forEach((fn) => fn())
        );
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    },
    [id, onStatusChange, onExit]
  );

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  const fit = useCallback(() => {
    fitRef.current?.fit();
  }, []);

  return { mount, focus, fit, termRef };
}
