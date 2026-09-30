import { describe, expect, it } from "vitest";
import { RESTING_ADJUST } from "./colorAdjust";
import { autoAdjustEqual, rescaleAuto, withAuto, withoutAuto } from "./autoAdjust";

const SUGGESTION = { ...RESTING_ADJUST, exposure: 0.2, warmth: -0.1 };

describe("the wand's share of the tools", () => {
  it("adds its reading once at the default amount, on top of what the user set", () => {
    const { adjust, autoAdjust } = withAuto({ ...RESTING_ADJUST, exposure: 0.1 }, SUGGESTION);

    expect(adjust.exposure).toBeCloseTo(0.3);
    expect(adjust.warmth).toBeCloseTo(-0.1);
    expect(autoAdjust).toMatchObject({ amount: 0.5, suggestion: SUGGESTION });
  });

  it("rescales only its own share when the Auto dial moves", () => {
    const first = withAuto({ ...RESTING_ADJUST, exposure: 0.1, contrast: 0.3 }, SUGGESTION);

    const doubled = rescaleAuto(first.adjust, first.autoAdjust, 1);
    expect(doubled.adjust.exposure).toBeCloseTo(0.5);
    expect(doubled.adjust.contrast).toBeCloseTo(0.3);

    const none = rescaleAuto(doubled.adjust, doubled.autoAdjust, 0);
    expect(none.adjust.exposure).toBeCloseTo(0.1);
    expect(none.autoAdjust.amount).toBe(0);
  });

  it("hands back the user's own values when the wand is turned off", () => {
    const own = { ...RESTING_ADJUST, exposure: -0.3, shadows: 0.2 };
    const { adjust, autoAdjust } = withAuto(own, SUGGESTION);

    const restored = withoutAuto(adjust, autoAdjust);

    expect(restored.exposure).toBeCloseTo(-0.3);
    expect(restored.shadows).toBeCloseTo(0.2);
    expect(restored.warmth).toBeCloseTo(0);
  });

  it("keeps every tool inside its range", () => {
    const { adjust } = withAuto({ ...RESTING_ADJUST, exposure: 0.95 }, SUGGESTION, 1);

    expect(adjust.exposure).toBe(1);
  });

  it("restores manual values after Auto reaches the end of a tool's range", () => {
    const own = { ...RESTING_ADJUST, exposure: 0.95 };
    const auto = withAuto(own, SUGGESTION);
    const full = rescaleAuto(auto.adjust, auto.autoAdjust, 1);
    const half = rescaleAuto(full.adjust, full.autoAdjust, 0.5);
    expect(half.adjust.exposure).toBe(1);
    expect(withoutAuto(half.adjust, half.autoAdjust).exposure).toBeCloseTo(0.95);
  });

  it("preserves manual changes made while Auto is on", () => {
    const auto = withAuto({ ...RESTING_ADJUST, exposure: 0.1 }, SUGGESTION);
    const edited = { ...auto.adjust, exposure: 0.4 };
    expect(withoutAuto(edited, auto.autoAdjust).exposure).toBeCloseTo(0.2);
    const full = rescaleAuto(edited, auto.autoAdjust, 1);
    expect(full.adjust.exposure).toBeCloseTo(0.6);
  });

  it("compares readings by value", () => {
    const reading = { amount: 0.5, suggestion: SUGGESTION };

    expect(autoAdjustEqual(reading, { amount: 0.5, suggestion: { ...SUGGESTION } })).toBe(true);
    expect(autoAdjustEqual(reading, { ...reading, amount: 0.6 })).toBe(false);
    expect(autoAdjustEqual(reading, null)).toBe(false);
    expect(autoAdjustEqual(null, null)).toBe(true);
  });
});
