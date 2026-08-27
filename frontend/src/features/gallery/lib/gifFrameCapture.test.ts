import { describe, expect, it } from "vitest";
import {
  clampFrameIndex,
  formatFrameOrdinal,
  gifFrameTargetName,
  stepFrameIndex,
} from "./gifFrameCapture";

describe("gifFrameTargetName", () => {
  it("names the sibling JPG from the frame index", () => {
    expect(gifFrameTargetName("C:\\Photos\\loop.gif", 7)).toBe("loop_f0007.jpg");
    expect(gifFrameTargetName("C:\\Photos\\loop.gif", 0)).toBe("loop_f0000.jpg");
  });

  it("pads to a sortable width", () => {
    expect(gifFrameTargetName("loop.gif", 1234)).toBe("loop_f1234.jpg");
  });

  it("keeps a dotfile-shaped name instead of eating it", () => {
    expect(gifFrameTargetName("C:\\Photos\\.gif", 3)).toBe(".gif_f0003.jpg");
  });

  it("cannot collide with a video frame from the same stem", () => {
    // Video stamps milliseconds, so clip.mp4 and clip.gif in one folder must never share a target name.
    expect(gifFrameTargetName("clip.gif", 4500)).toBe("clip_f4500.jpg");
  });

  it("survives a non-finite index rather than writing NaN into a filename", () => {
    expect(gifFrameTargetName("loop.gif", Number.NaN)).toBe("loop_f0000.jpg");
    expect(gifFrameTargetName("loop.gif", -5)).toBe("loop_f0000.jpg");
  });
});

describe("clampFrameIndex", () => {
  it("holds the index inside the animation", () => {
    expect(clampFrameIndex(-3, 24)).toBe(0);
    expect(clampFrameIndex(30, 24)).toBe(23);
    expect(clampFrameIndex(7, 24)).toBe(7);
  });

  it("collapses to zero when the frame count is unknown", () => {
    expect(clampFrameIndex(5, 0)).toBe(0);
    expect(clampFrameIndex(Number.NaN, 24)).toBe(0);
  });

  it("rounds a fractional slider value onto a real frame", () => {
    expect(clampFrameIndex(6.7, 24)).toBe(7);
  });
});

describe("stepFrameIndex", () => {
  it("nudges one frame per press", () => {
    expect(stepFrameIndex(7, 1, 24)).toBe(8);
    expect(stepFrameIndex(7, -1, 24)).toBe(6);
  });

  it("stops at both ends instead of wrapping", () => {
    expect(stepFrameIndex(0, -1, 24)).toBe(0);
    expect(stepFrameIndex(23, 1, 24)).toBe(23);
  });
});

describe("formatFrameOrdinal", () => {
  it("reads one-based so the first frame is frame 1", () => {
    expect(formatFrameOrdinal(0, 24)).toBe("1");
    expect(formatFrameOrdinal(23, 24)).toBe("24");
  });

  it("reports nothing to show when the count has not landed", () => {
    expect(formatFrameOrdinal(0, 0)).toBe("0");
  });
});
