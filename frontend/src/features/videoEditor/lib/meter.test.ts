import { describe, expect, it } from "vitest";
import { VIDEO_PROJECT_TRUE_PEAK_CEILING_DB } from "@/shared/constants";
import { meterAlarm, meterFraction, toDecibels } from "./meter";

describe("mix meter scale", () => {
  it("reads full scale as 0 dB and silence as no level at all", () => {
    expect(toDecibels(1)).toBe(0);
    expect(toDecibels(0.5)).toBeCloseTo(-6.02, 2);
    expect(toDecibels(0)).toBe(-Infinity);
  });

  it("fills from the floor to full scale and no further", () => {
    expect(meterFraction(-Infinity)).toBe(0);
    expect(meterFraction(-90)).toBe(0);
    expect(meterFraction(-30)).toBe(0.5);
    expect(meterFraction(6)).toBe(1);
  });

  it("warns above the export ceiling and alarms at full scale", () => {
    expect(meterAlarm(VIDEO_PROJECT_TRUE_PEAK_CEILING_DB - 0.1)).toBeNull();
    expect(meterAlarm(VIDEO_PROJECT_TRUE_PEAK_CEILING_DB + 0.1)).toBe("hot");
    expect(meterAlarm(0)).toBe("clip");
    expect(meterAlarm(4.5)).toBe("clip");
  });
});
