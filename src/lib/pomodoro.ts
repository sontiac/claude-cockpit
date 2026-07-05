export type PomodoroPhase = "focus" | "break";

export interface PomodoroState {
  phase: PomodoroPhase;
  /** Epoch ms when the running phase ends; null while paused/idle. */
  endsAt: number | null;
  /** Ms left in the phase; authoritative only while paused/idle. */
  remainingMs: number;
  /** Completed focus sessions (the cycle tally). */
  cycles: number;
}

export const minutesToMs = (m: number) => Math.round(m * 60_000);

export function idleState(workMinutes: number): PomodoroState {
  return {
    phase: "focus",
    endsAt: null,
    remainingMs: minutesToMs(workMinutes),
    cycles: 0,
  };
}

export function start(s: PomodoroState, now: number): PomodoroState {
  if (s.endsAt !== null) return s;
  return { ...s, endsAt: now + s.remainingMs };
}

export function pause(s: PomodoroState, now: number): PomodoroState {
  if (s.endsAt === null) return s;
  return { ...s, endsAt: null, remainingMs: Math.max(0, s.endsAt - now) };
}

export function reset(s: PomodoroState, workMinutes: number): PomodoroState {
  return { ...idleState(workMinutes), cycles: s.cycles };
}

/** Ms left in the current phase. Derives from the wall clock while running, so
 * interval throttling can never drift the countdown. */
export function remaining(s: PomodoroState, now: number): number {
  return s.endsAt === null ? s.remainingMs : Math.max(0, s.endsAt - now);
}

/**
 * Advance the clock. When the running phase has ended, flip to the other
 * phase — paused at its full duration (no surprise auto-start) — and report
 * which phase completed so the caller can play a sound / notify. Completing a
 * focus phase bumps the cycle tally.
 */
export function tick(
  s: PomodoroState,
  now: number,
  workMinutes: number,
  breakMinutes: number
): { state: PomodoroState; completed: PomodoroPhase | null } {
  if (s.endsAt === null || now < s.endsAt) return { state: s, completed: null };
  if (s.phase === "focus") {
    return {
      state: {
        phase: "break",
        endsAt: null,
        remainingMs: minutesToMs(breakMinutes),
        cycles: s.cycles + 1,
      },
      completed: "focus",
    };
  }
  return {
    state: {
      phase: "focus",
      endsAt: null,
      remainingMs: minutesToMs(workMinutes),
      cycles: s.cycles,
    },
    completed: "break",
  };
}
