import { useState, useEffect } from "react";
import type React from "react";
import { Timer, Play, Pause as PauseIcon, RotateCcw } from "lucide-react";
import { PaneHeader } from "./PaneHeader";
import { useSounds } from "../../hooks/useSounds";
import { useNotifications } from "../../hooks/useNotifications";
import {
  idleState,
  start,
  pause,
  reset,
  remaining,
  tick,
  minutesToMs,
  type PomodoroState,
} from "../../lib/pomodoro";
import type { PomodoroPane } from "../../types/pane";
import type { Workspace } from "../../types/terminal";

interface PomodoroCellProps {
  pane: PomodoroPane;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onSetDurations: (workMinutes: number, breakMinutes: number) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
}

const RING_R = 54;
const RING_CIRC = 2 * Math.PI * RING_R;
const FOCUS_COLOR = "#10b981";
const BREAK_COLOR = "#06b6d4";

function fmt(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clampMinutes(v: number): number {
  return Math.min(180, Math.max(1, Math.round(v) || 1));
}

/**
 * Pomodoro timer pane. The countdown derives from a stored end timestamp, so
 * re-renders, workspace switches, and interval throttling can't drift it.
 * Phase completion plays a ding and fires an OS notification, then waits —
 * the next phase never auto-starts. Timer state is runtime-only; the pane's
 * durations persist.
 */
export function PomodoroCell({
  pane,
  isActive,
  onSelect,
  onClose,
  onRename,
  onSetDurations,
  onHeaderPointerDown,
  workspaces,
  onMove,
}: PomodoroCellProps) {
  const [state, setState] = useState<PomodoroState>(() => idleState(pane.workMinutes));
  const [, setDisplayTick] = useState(0);
  const { play } = useSounds();
  const { notify } = useNotifications();

  const running = state.endsAt !== null;

  // Drive the countdown display and detect phase completion while running.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const { state: next, completed } = tick(state, now, pane.workMinutes, pane.breakMinutes);
      if (completed) {
        setState(next);
        play("ding");
        notify(
          completed === "focus" ? "Focus session complete" : "Break over",
          completed === "focus" ? "Time for a break." : "Back to focus."
        ).catch(console.error);
      } else {
        setDisplayTick((t) => t + 1);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [running, state, pane.workMinutes, pane.breakMinutes, play, notify]);

  const now = Date.now();
  const left = remaining(state, now);
  const phaseTotal = minutesToMs(state.phase === "focus" ? pane.workMinutes : pane.breakMinutes);
  const frac = phaseTotal === 0 ? 0 : left / phaseTotal;
  const ringColor = state.phase === "focus" ? FOCUS_COLOR : BREAK_COLOR;
  const filledDots = state.cycles === 0 ? 0 : ((state.cycles - 1) % 4) + 1;

  const changeDurations = (workMinutes: number, breakMinutes: number) => {
    onSetDurations(workMinutes, breakMinutes);
    // Changing durations restarts the clock at the new focus length (cycle
    // tally survives) — predictable, and only reachable while paused.
    setState((s) => ({ ...idleState(workMinutes), cycles: s.cycles }));
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
    >
      <PaneHeader
        icon={<Timer size={12} />}
        label={pane.label}
        color={pane.color}
        isActive={isActive}
        workspaceId={pane.workspaceId}
        workspaces={workspaces}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onMove={onMove}
        onHeaderPointerDown={onHeaderPointerDown}
      />

      <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center gap-3 py-4">
        {/* Ring countdown */}
        <div className="relative w-36 h-36">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r={RING_R}
              fill="none"
              stroke="rgba(148, 163, 184, 0.15)"
              strokeWidth="6"
            />
            <circle
              cx="60"
              cy="60"
              r={RING_R}
              fill="none"
              stroke={ringColor}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={RING_CIRC * (1 - frac)}
              style={{ transition: "stroke-dashoffset 250ms linear" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {fmt(left)}
            </span>
            <span
              className="text-[10px] uppercase tracking-widest"
              style={{ color: ringColor }}
            >
              {state.phase === "focus" ? "Focus" : "Break"}
            </span>
          </div>
        </div>

        {/* Cycle tally */}
        <div className="flex items-center gap-1.5" title={`${state.cycles} focus sessions done`}>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: i < filledDots ? FOCUS_COLOR : "rgba(148, 163, 184, 0.25)",
              }}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {running ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setState((s) => pause(s, Date.now()));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-foreground hover:bg-white/10 text-xs font-medium"
            >
              <PauseIcon size={12} />
              Pause
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setState((s) => start(s, Date.now()));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-medium"
            >
              <Play size={12} />
              Start
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setState((s) => reset(s, pane.workMinutes));
            }}
            className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-white/5"
            title="Reset"
          >
            <RotateCcw size={12} />
          </button>
        </div>

        {/* Durations (editable while paused) */}
        {!running && (
          <div className="flex items-center gap-3 text-xs text-foreground-muted">
            <label className="flex items-center gap-1.5">
              Focus
              <input
                type="number"
                min={1}
                max={180}
                value={pane.workMinutes}
                onChange={(e) =>
                  changeDurations(clampMinutes(Number(e.target.value)), pane.breakMinutes)
                }
                onClick={(e) => e.stopPropagation()}
                className="w-14 bg-white/5 border border-card-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent-cyan tabular-nums"
              />
              min
            </label>
            <label className="flex items-center gap-1.5">
              Break
              <input
                type="number"
                min={1}
                max={180}
                value={pane.breakMinutes}
                onChange={(e) =>
                  changeDurations(pane.workMinutes, clampMinutes(Number(e.target.value)))
                }
                onClick={(e) => e.stopPropagation()}
                className="w-14 bg-white/5 border border-card-border rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent-cyan tabular-nums"
              />
              min
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
