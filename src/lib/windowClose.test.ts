import { describe, it, expect } from "vitest";
import { closeConfirmMessage } from "./windowClose";

describe("closeConfirmMessage", () => {
  it("returns null for an empty window (no prompt)", () => {
    expect(closeConfirmMessage(0, 0)).toBeNull();
  });

  it("singularizes correctly", () => {
    expect(closeConfirmMessage(1, 0)).toBe(
      "Close this window? This will permanently close 1 terminal in it."
    );
    expect(closeConfirmMessage(0, 1)).toBe(
      "Close this window? This will permanently close 1 pane in it."
    );
  });

  it("pluralizes and joins both kinds", () => {
    expect(closeConfirmMessage(2, 3)).toBe(
      "Close this window? This will permanently close 2 terminals and 3 panes in it."
    );
  });

  it("omits a kind with zero count", () => {
    expect(closeConfirmMessage(2, 0)).toBe(
      "Close this window? This will permanently close 2 terminals in it."
    );
  });
});
