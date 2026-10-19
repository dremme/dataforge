import { describe, expect, it } from "vitest";
import { formatTimecode } from "./timeline";
import { formatClockSeconds, parseTimecode } from "./timecode";

describe("parseTimecode", () => {
  it("reads back every timecode the editor shows", () => {
    for (const seconds of [0, 1 / 24, 1.5, 61.25, 3725]) {
      const shown = formatTimecode(seconds, 24);
      expect(parseTimecode(shown, 24)).toBeCloseTo(Math.round(seconds * 24) / 24, 9);
    }
  });

  it("takes short timecodes, frames, seconds and relative frames", () => {
    expect(parseTimecode("01:12", 24)).toBeCloseTo(1.5);
    expect(parseTimecode("36f", 24)).toBeCloseTo(1.5);
    expect(parseTimecode("1.51s", 24)).toBeCloseTo(36 / 24);
    expect(parseTimecode("+12", 24, 1)).toBeCloseTo(1.5);
    expect(parseTimecode("- 24", 24, 1)).toBe(0);
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const text of ["", "abc", "1:2:3:4:5", "00:24", "00:61:00", "1.5"]) {
      expect(parseTimecode(text, 24)).toBeNull();
    }
  });
});

describe("formatClockSeconds", () => {
  it("reads a frame timecode back as seconds", () => {
    // 00:00:02:22 at 24 fps: two seconds and 22 frames.
    expect(formatClockSeconds(2 + 22 / 24)).toBe("2.92 s");
    expect(formatClockSeconds(0)).toBe("0.00 s");
  });

  it("names minutes and hours instead of a second timecode-like format", () => {
    expect(formatClockSeconds(65)).toBe("1 min 5.00 s");
    expect(formatClockSeconds(59.999)).toBe("1 min 0.00 s");
    expect(formatClockSeconds(3725.5)).toBe("1 h 2 min 5.50 s");
  });
});
