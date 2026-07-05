import { describe, it, expect } from "vitest";
import { idleState, start, pause, reset, remaining, tick, minutesToMs } from "./pomodoro";

const T0 = 1_000_000; // arbitrary epoch ms

describe("pomodoro clock", () => {
  it("idles at the full focus duration", () => {
    const s = idleState(25);
    expect(s.phase).toBe("focus");
    expect(s.endsAt).toBeNull();
    expect(s.remainingMs).toBe(minutesToMs(25));
    expect(s.cycles).toBe(0);
    expect(remaining(s, T0)).toBe(minutesToMs(25));
  });

  it("start sets endsAt from remaining; remaining derives from the clock", () => {
    const s = start(idleState(25), T0);
    expect(s.endsAt).toBe(T0 + minutesToMs(25));
    expect(remaining(s, T0 + 60_000)).toBe(minutesToMs(25) - 60_000);
  });

  it("pause freezes remaining; resume continues from there", () => {
    let s = start(idleState(25), T0);
    s = pause(s, T0 + 5 * 60_000);
    expect(s.endsAt).toBeNull();
    expect(s.remainingMs).toBe(minutesToMs(20));
    s = start(s, T0 + 60 * 60_000); // resume an hour later
    expect(remaining(s, T0 + 60 * 60_000)).toBe(minutesToMs(20));
  });

  it("start and pause are no-ops when already in that state", () => {
    const idle = idleState(25);
    expect(pause(idle, T0)).toBe(idle);
    const running = start(idle, T0);
    expect(start(running, T0 + 1)).toBe(running);
  });

  it("tick before the deadline changes nothing", () => {
    const s = start(idleState(25), T0);
    const { state, completed } = tick(s, T0 + 1000, 25, 5);
    expect(completed).toBeNull();
    expect(state).toBe(s);
  });

  it("focus completion flips to a paused break and bumps cycles", () => {
    const s = start(idleState(25), T0);
    const { state, completed } = tick(s, T0 + minutesToMs(25), 25, 5);
    expect(completed).toBe("focus");
    expect(state.phase).toBe("break");
    expect(state.endsAt).toBeNull();
    expect(state.remainingMs).toBe(minutesToMs(5));
    expect(state.cycles).toBe(1);
  });

  it("break completion flips back to a paused focus without bumping cycles", () => {
    const afterFocus = tick(start(idleState(25), T0), T0 + minutesToMs(25), 25, 5).state;
    const runningBreak = start(afterFocus, T0);
    const { state, completed } = tick(runningBreak, T0 + minutesToMs(5), 25, 5);
    expect(completed).toBe("break");
    expect(state.phase).toBe("focus");
    expect(state.endsAt).toBeNull();
    expect(state.remainingMs).toBe(minutesToMs(25));
    expect(state.cycles).toBe(1);
  });

  it("reset returns to an idle focus phase but keeps the cycle tally", () => {
    const afterFocus = tick(start(idleState(25), T0), T0 + minutesToMs(25), 25, 5).state;
    const s = reset(afterFocus, 25);
    expect(s.phase).toBe("focus");
    expect(s.remainingMs).toBe(minutesToMs(25));
    expect(s.cycles).toBe(1);
  });

  it("remaining never goes negative", () => {
    const s = start(idleState(25), T0);
    expect(remaining(s, T0 + minutesToMs(26))).toBe(0);
  });
});
