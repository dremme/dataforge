import { describe, expect, it } from "vitest";
import { AUDIO_HIGH_CUT_MAX_HZ } from "@/shared/constants";
import {
  adjustUnit,
  amount,
  decibels,
  degrees,
  highCut,
  lowCut,
  parseNumber,
  percent,
  seconds,
  strength,
} from "./sliderUnits";

describe("sliderUnits", () => {
  it("reads a number with or without the unit it is shown with", () => {
    expect(percent.parse("150")).toBe(1.5);
    expect(percent.parse("150 %")).toBe(1.5);
    expect(seconds.parse("1,5 s")).toBe(1.5);
    expect(degrees.parse("-45°")).toBe(-45);
    expect(amount.parse("80")).toBe(0.8);
    expect(decibels.parse("−3 dB")).toBe(-3);
    expect(decibels.parse("+4.5")).toBe(4.5);
  });

  it("reads back what it shows", () => {
    for (const [unit, value] of [
      [percent, 0.35],
      [seconds, 1.25],
      [degrees, -90],
      [decibels, -6],
      [adjustUnit("exposure"), -0.2],
      [adjustUnit("hue"), 12],
    ] as const) {
      expect(unit.parse(unit.format(value))).toBeCloseTo(value);
    }
  });

  it("reads hertz in kHz and off at either end of a cut", () => {
    expect(lowCut.parse("120 Hz")).toBe(120);
    expect(lowCut.parse("Off")).toBe(0);
    expect(highCut.parse("8k")).toBe(8000);
    expect(highCut.parse("1.2 kHz")).toBe(1200);
    expect(highCut.parse("off")).toBe(AUDIO_HIGH_CUT_MAX_HZ);
    expect(strength.parse("off")).toBe(0);
    expect(strength.format(0)).toBe("Off");
  });

  it("scales color tools as the gallery shows them", () => {
    expect(adjustUnit("contrast").parse("+25")).toBe(0.25);
    expect(adjustUnit("hue").parse("-10°")).toBe(-10);
  });

  it("refuses text that is not one number", () => {
    for (const text of ["", "abc", "1.2.3", "5 - 3", "--1"]) {
      expect(parseNumber(text)).toBeNull();
    }
    expect(percent.parse("half")).toBeNull();
  });
});
