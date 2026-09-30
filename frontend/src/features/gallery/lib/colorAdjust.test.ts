import { describe, expect, it } from "vitest";
import { COLOR_ADJUST_CASES } from "@/test/colorAdjustCases";
import {
  RESTING_ADJUST,
  adjustEqual,
  adjustPixel,
  buildAdjustLut,
  clampAdjust,
  formatAdjustValue,
  isAdjustIdentity,
  isGlobalIdentity,
} from "./colorAdjust";

describe("adjustPixel", () => {
  it("reproduces every answer backend/color_adjust.py gives", () => {
    expect(COLOR_ADJUST_CASES.length).toBeGreaterThan(300);
    for (const { adjust, input, output } of COLOR_ADJUST_CASES) {
      const result = adjustPixel(input, { ...RESTING_ADJUST, ...adjust });
      result.forEach((value, channel) => {
        expect(Math.abs(value - output[channel])).toBeLessThan(1e-5);
      });
    }
  });

  it("leaves every color alone at rest", () => {
    for (const color of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.6, 0.9],
    ] as const) {
      adjustPixel(color, RESTING_ADJUST).forEach((value, channel) =>
        expect(value).toBeCloseTo(color[channel], 9),
      );
    }
  });
});

describe("buildAdjustLut", () => {
  const adjust = { ...RESTING_ADJUST, exposure: 0.3, warmth: 0.2, hue: 30 };

  it("holds the pixel function on a grid with red varying fastest", () => {
    const size = 5;
    const lut = buildAdjustLut(adjust, size);
    const [red, green, blue] = [4, 3, 1];

    const index = ((blue * size + green) * size + red) * 4;
    const expected = adjustPixel([red / 4, green / 4, blue / 4], adjust);
    expected.forEach((value, channel) => expect(lut[index + channel]).toBeCloseTo(value, 6));
    expect(lut[index + 3]).toBe(1);
  });

  it("is an identity cube at rest", () => {
    const lut = buildAdjustLut(RESTING_ADJUST, 3);

    const centre = 4 * 13;
    Array.from(lut.slice(centre, centre + 3)).forEach((value) => expect(value).toBeCloseTo(0.5, 6));
  });
});

describe("identity and equality", () => {
  it("counts any tool as a change, and detail tools as not touching the LUT", () => {
    expect(isAdjustIdentity(RESTING_ADJUST)).toBe(true);
    expect(isAdjustIdentity({ ...RESTING_ADJUST, noise_reduction: 0.1 })).toBe(false);
    expect(isGlobalIdentity({ ...RESTING_ADJUST, definition: 0.5, noise_reduction: 0.5 })).toBe(
      true,
    );
    expect(isGlobalIdentity({ ...RESTING_ADJUST, hue: 10 })).toBe(false);
  });

  it("compares every tool", () => {
    expect(adjustEqual(RESTING_ADJUST, { ...RESTING_ADJUST })).toBe(true);
    expect(adjustEqual(RESTING_ADJUST, { ...RESTING_ADJUST, tint: 0.01 })).toBe(false);
  });

  it("clamps float noise back inside each range", () => {
    const clamped = clampAdjust({
      ...RESTING_ADJUST,
      exposure: 1.0000001,
      hue: -181,
      definition: -0.2,
    });

    expect(clamped).toMatchObject({ exposure: 1, hue: -180, definition: 0 });
  });
});

describe("formatAdjustValue", () => {
  it("signs tones in hundredths and hue in degrees", () => {
    expect(formatAdjustValue("exposure", 0.24)).toBe("+24");
    expect(formatAdjustValue("shadows", -0.5)).toBe("-50");
    expect(formatAdjustValue("contrast", 0)).toBe("0");
    expect(formatAdjustValue("hue", 30.4)).toBe("+30°");
    expect(formatAdjustValue("hue", -90)).toBe("-90°");
  });
});
