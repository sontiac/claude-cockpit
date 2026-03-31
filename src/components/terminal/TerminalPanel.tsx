import { useEffect, useRef } from "react";
import { useTerminal } from "../../hooks/useTerminal";
import type { TerminalStatus } from "../../types/terminal";

interface TerminalPanelProps {
  id: string;
  active: boolean;
  onStatusChange: (status: TerminalStatus) => void;
  onExit: (code: number | null) => void;
}

export function TerminalPanel({
  id,
  active,
  onStatusChange,
  onExit,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const { mount, focus, fit } = useTerminal({
    id,
    onStatusChange,
    onExit,
  });

  useEffect(() => {
    if (containerRef.current && !mountedRef.current) {
      mountedRef.current = true;
      mount(containerRef.current);
    }
  }, [mount]);

  useEffect(() => {
    if (active) {
      focus();
      fit();
    }
  }, [active, focus, fit]);

  return (
    <div
      ref={containerRef}
      className="terminal-container w-full h-full"
      style={{ display: active ? "block" : "none" }}
    />
  );
}
