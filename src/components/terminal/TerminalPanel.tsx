import { useEffect, useRef } from "react";
import { useTerminal } from "../../hooks/useTerminal";
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
  const mountedRef = useRef(false);
  const { mount } = useTerminal({
    id,
    onStatusChange,
    onExit,
    onRenameDetected,
  });

  useEffect(() => {
    if (containerRef.current && !mountedRef.current) {
      mountedRef.current = true;
      mount(containerRef.current);
    }
  }, [mount]);

  return (
    <div
      ref={containerRef}
      className="terminal-container w-full h-full"
    />
  );
}
