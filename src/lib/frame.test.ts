import { describe, it, expect } from "vitest";
import { toLogicalFrame } from "./frame";

describe("toLogicalFrame", () => {
  it("divides physical coordinates by the scale factor on a 2x display", () => {
    expect(
      toLogicalFrame({ x: 0, y: 66 }, { width: 3456, height: 2168 }, 2)
    ).toEqual({ x: 0, y: 33, width: 1728, height: 1084 });
  });

  it("is the identity on a 1x display", () => {
    expect(
      toLogicalFrame({ x: -2560, y: -193 }, { width: 2560, height: 1440 }, 1)
    ).toEqual({ x: -2560, y: -193, width: 2560, height: 1440 });
  });

  it("rounds fractional points to the nearest integer", () => {
    expect(
      toLogicalFrame({ x: 101, y: 33 }, { width: 1281, height: 799 }, 2)
    ).toEqual({ x: 51, y: 17, width: 641, height: 400 });
  });
});
