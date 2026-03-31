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

export function useTerminal({ id, onStatusChange, onExit, onRenameDetected }: UseTerminalOptions) {
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

      // Scroll-safe fit: preserve the viewport scroll position across fit() calls.
      // fit() can resize the terminal rows which resets the scroll position.
      let lastCols = 0;
      let lastRows = 0;
      const safeFit = () => {
        const dims = fitAddon.proposeDimensions();
        if (!dims) return;

        // Skip if dimensions haven't actually changed
        if (dims.cols === lastCols && dims.rows === lastRows) return;

        // Save scroll state: viewportY is the line offset from the top of the scrollback
        const savedViewportY = term.buffer.active.viewportY;
        const wasAtBottom =
          savedViewportY >= term.buffer.active.baseY;

        fitAddon.fit();
        lastCols = dims.cols;
        lastRows = dims.rows;

        // Restore scroll: if user was at the bottom (following output), stay there.
        // Otherwise, restore to where they were.
        if (wasAtBottom) {
          term.scrollToBottom();
        } else {
          term.scrollToLine(savedViewportY);
        }
      };

      safeFit();

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
      let renameBuf = "";
      const unlistenOutput = onTerminalOutput(id, (data) => {
        const bytes = new Uint8Array(data);
        term.write(bytes);

        // Detect Claude Code /rename output: "Session renamed to: <name>"
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

      // Listen for status changes
      const unlistenStatus = onTerminalStatus(id, (status) => {
        onStatusChange?.(status as TerminalStatus);
      });

      // Listen for exit
      const unlistenExit = onTerminalExit(id, (code) => {
        onExit?.(code);
      });

      // Debounced resize observer — prevents spurious fit() on focus changes.
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(safeFit, 50);
      });
      resizeObserver.observe(container);

      // Initial resize to tell PTY our actual size after layout settles
      setTimeout(() => {
        safeFit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ptyResize(id, dims.cols, dims.rows).catch(console.error);
        }
      }, 50);

      // Cleanup
      return () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeObserver.disconnect();
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

  const fit = useCallback(() => {
    // External fit calls also use scroll-safe approach
    if (!termRef.current || !fitRef.current) return;
    const term = termRef.current;
    const fitAddon = fitRef.current;
    const savedViewportY = term.buffer.active.viewportY;
    const wasAtBottom = savedViewportY >= term.buffer.active.baseY;
    fitAddon.fit();
    if (wasAtBottom) {
      term.scrollToBottom();
    } else {
      term.scrollToLine(savedViewportY);
    }
  }, []);

  return { mount, focus, fit, termRef };
}
