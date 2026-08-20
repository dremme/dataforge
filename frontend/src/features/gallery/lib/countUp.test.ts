import { describe, expect, it } from "vitest";
import { COUNT_UP_MS, easedCount } from "./countUp";

describe("easedCount", () => {
  it("stays on the start until time has moved", () => {
    expect(easedCount(0, 40, 0)).toBe(0);
    expect(easedCount(0, 40, -10)).toBe(0);
  });

  it("lands on the target once the duration has elapsed", () => {
    expect(easedCount(0, 40, COUNT_UP_MS)).toBe(40);
    expect(easedCount(0, 40, COUNT_UP_MS + 50)).toBe(40);
  });

  it("skips the curve when there is nowhere to go", () => {
    expect(easedCount(7, 7, COUNT_UP_MS / 2)).toBe(7);
  });

  it("is ahead of a linear ramp, so the figure does not linger on small numbers", () => {
    const elapsed = COUNT_UP_MS / 2;
    const eased = easedCount(0, 100, elapsed);
    expect(eased).toBe(88);
    expect(eased).toBeGreaterThan((100 * elapsed) / COUNT_UP_MS);
  });

  it("counts down when the target is smaller than the start", () => {
    expect(easedCount(40, 10, COUNT_UP_MS / 2)).toBe(14);
  });
});
