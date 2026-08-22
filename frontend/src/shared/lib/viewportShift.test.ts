import { describe, expect, it } from "vitest";
import { axisViewportShift } from "./viewportShift";

const VIEWPORT = 1000;
const GUTTER = 8;

const shift = (start: number, length: number, gutter = GUTTER) =>
  axisViewportShift({ start, length }, VIEWPORT, gutter);

describe("axisViewportShift", () => {
  it("leaves a box that already fits", () => {
    expect(shift(400, 200)).toBe(0);
  });

  it("pulls a box back from the far edge", () => {
    // End at 1050 overruns the 992px limit by 58.
    expect(shift(850, 200)).toBe(-58);
  });

  it("pushes a box back from the near edge", () => {
    expect(shift(-30, 200)).toBe(38);
  });

  it("treats a box resting exactly on the gutter as fitting", () => {
    expect(shift(GUTTER, VIEWPORT - GUTTER * 2)).toBe(0);
  });

  // The clamp: without it, correcting one overflow just creates the other.
  it("stops at the near gutter rather than sliding a too-long box off it", () => {
    // 1200px long with only 92px of room before it: it moves 92, not 300.
    expect(shift(100, 1200)).toBe(-92);
  });

  it("stops at the far gutter rather than sliding a too-long box off it", () => {
    expect(shift(-300, 1200)).toBe(92);
  });

  it("honours a caller's own gutter", () => {
    expect(shift(850, 200, 16)).toBe(-66);
  });

  it("works down the vertical axis on the same terms", () => {
    expect(axisViewportShift({ start: 700, length: 200 }, 800, 16)).toBe(-116);
  });
});
