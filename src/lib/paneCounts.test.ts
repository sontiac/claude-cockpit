import { describe, it, expect } from "vitest";
import { paneCountLabel } from "./paneCounts";

describe("paneCountLabel", () => {
  it("returns Empty for no panes", () => {
    expect(paneCountLabel([])).toBe("Empty");
  });

  it("labels a single pane by its kind", () => {
    expect(paneCountLabel([{ kind: "note" }])).toBe("1 note");
    expect(paneCountLabel([{ kind: "pomodoro" }])).toBe("1 timer");
    expect(paneCountLabel([{ kind: "mdviewer" }])).toBe("1 plan");
    expect(paneCountLabel([{ kind: "terminal" }])).toBe("1 terminal");
  });

  it("pluralizes and joins mixed kinds in stable order", () => {
    expect(
      paneCountLabel([
        { kind: "note" },
        { kind: "terminal" },
        { kind: "terminal" },
        { kind: "pomodoro" },
      ])
    ).toBe("2 terminals · 1 note · 1 timer");
  });
});
