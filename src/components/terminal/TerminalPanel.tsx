import { useEffect, useRef } from "react";
import { useTerminal } from "../../hooks/useTerminal";
import { useFontSize } from "../../hooks/useFontSize";
import type { TerminalStatus } from "../../types/terminal";

interface TerminalPanelProps {
  id: string;
  onStatusChange: (status: TerminalStatus) => void;
  onExit: (code: number | null) => void;
  onRenameDetected?: (newName: string) => void;
}

export function TerminalPanel({
  id,
  onStatusChange,
  onExit,
  onRenameDetected,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fontSize = useFontSize();
  const { mount } = useTerminal({
    id,
    fontSize,
    onStatusChange,
    onExit,
    onRenameDetected,
  });

  // `mount` is stable per terminal id, so this runs once on mount and the
  // returned cleanup runs on unmount — disposing the xterm instance, its PTY
  // output/status/exit listeners, the ResizeObserver, and the WebGL addon.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return mount(container);
  }, [mount]);

  return (
    <div
      ref={containerRef}
      className="terminal-container w-full h-full"
    />
  );
}
