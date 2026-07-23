import { describe, it, expect } from "vitest";
import { closeWindowConfirm, quitAppConfirm } from "./windowClose";

describe("closeWindowConfirm", () => {
  it("returns null for an empty window (no prompt)", () => {
    expect(closeWindowConfirm(0, 0)).toBeNull();
  });

  it("singularizes correctly", () => {
    expect(closeWindowConfirm(1, 0)?.body).toBe(
      "This will permanently close 1 terminal in it."
    );
    expect(closeWindowConfirm(0, 1)?.body).toBe(
      "This will permanently close 1 pane in it."
    );
  });

  it("pluralizes and joins both kinds", () => {
    expect(closeWindowConfirm(2, 3)).toEqual({
      title: "Close this window?",
      body: "This will permanently close 2 terminals and 3 panes in it.",
      confirmLabel: "Close window",
    });
  });

  it("omits a kind with zero count", () => {
    expect(closeWindowConfirm(2, 0)?.body).toBe(
      "This will permanently close 2 terminals in it."
    );
  });
});

describe("quitAppConfirm", () => {
  it("returns null for an empty window (quit silently)", () => {
    expect(quitAppConfirm(0, 0)).toBeNull();
  });

  it("names the live content and mentions session recovery", () => {
    expect(quitAppConfirm(2, 1)).toEqual({
      title: "Quit Claude Cockpit?",
      body: "Quitting will close 2 terminals and 1 pane. You can restore this session the next time Cockpit launches.",
      confirmLabel: "Quit",
    });
  });

  it("singularizes correctly", () => {
    expect(quitAppConfirm(1, 0)?.body).toBe(
      "Quitting will close 1 terminal. You can restore this session the next time Cockpit launches."
    );
  });
});
