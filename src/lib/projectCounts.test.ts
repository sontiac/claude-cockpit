import { describe, it, expect } from "vitest";
import { countTerminalsByProject } from "./projectCounts";

describe("countTerminalsByProject", () => {
  it("counts terminals grouped by project id", () => {
    const terminals = [
      { project_id: "a" },
      { project_id: "b" },
      { project_id: "a" },
      { project_id: "a" },
    ];
    const counts = countTerminalsByProject(terminals);
    expect(counts.get("a")).toBe(3);
    expect(counts.get("b")).toBe(1);
  });

  it("ignores terminals without a project", () => {
    const counts = countTerminalsByProject([
      { project_id: null },
      { project_id: "a" },
    ]);
    expect(counts.size).toBe(1);
    expect(counts.get("a")).toBe(1);
  });

  it("returns an empty map for no terminals", () => {
    expect(countTerminalsByProject([]).size).toBe(0);
  });
});
