import { describe, expect, it } from "vitest";
import {
  END_EPSILON,
  FRAME_STEP_SECONDS,
  clampFrameTime,
  formatFrameTime,
  frameSaveOutcome,
  frameTimeStamp,
  hasUsableDuration,
  snapFrameTime,
  stepFrameTime,
  videoFrameTargetName,
} from "./videoFrameCapture";

describe("frameTimeStamp", () => {
  it("pads to a sortable width", () => {
    expect(frameTimeStamp(0)).toBe("0000000");
    expect(frameTimeStamp(4.5)).toBe("0004500");
  });

  it("rounds to the nearest millisecond", () => {
    expect(frameTimeStamp(4.54158)).toBe("0004542");
  });

  it("keeps every digit past the padding width", () => {
    expect(frameTimeStamp(20000)).toBe("20000000");
  });

  it("falls back to zero for a time the browser has not resolved", () => {
    expect(frameTimeStamp(Number.NaN)).toBe("0000000");
    expect(frameTimeStamp(-1)).toBe("0000000");
  });
});

describe("videoFrameTargetName", () => {
  it("stamps the frame time onto a Windows path's leaf", () => {
    expect(videoFrameTargetName("C:\\Photos\\Vacation\\sunset.mp4", 4.5)).toBe(
      "sunset_0004500.jpg",
    );
  });

  it("stamps the frame time onto a POSIX path's leaf", () => {
    expect(videoFrameTargetName("/home/photos/sunset.mp4", 0)).toBe("sunset_0000000.jpg");
  });

  it("gives adjacent frames distinct names", () => {
    expect(videoFrameTargetName("clip.mp4", 4.5)).not.toBe(
      videoFrameTargetName("clip.mp4", 4.5417),
    );
  });

  it("gives one frame one name however it was scrubbed to", () => {
    expect(videoFrameTargetName("clip.mp4", 4.5)).toBe(videoFrameTargetName("clip.mp4", 4.5002));
  });

  it("appends to a name with no extension", () => {
    expect(videoFrameTargetName("C:\\Photos\\clip", 1)).toBe("clip_0001000.jpg");
  });

  it("keeps a dotfile-shaped name intact", () => {
    expect(videoFrameTargetName("C:\\Photos\\.mp4", 1)).toBe(".mp4_0001000.jpg");
  });

  it("cuts only the last extension of a double-suffixed name", () => {
    expect(videoFrameTargetName("clip.tar.mp4", 1)).toBe("clip.tar_0001000.jpg");
  });
});

describe("hasUsableDuration", () => {
  it("rejects a duration the browser has not resolved", () => {
    expect(hasUsableDuration(Number.NaN)).toBe(false);
    expect(hasUsableDuration(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("rejects an empty or negative duration", () => {
    expect(hasUsableDuration(0)).toBe(false);
    expect(hasUsableDuration(-1)).toBe(false);
  });

  it("accepts a real duration", () => {
    expect(hasUsableDuration(12.5)).toBe(true);
  });
});

describe("clampFrameTime", () => {
  it("collapses to zero when the duration is unusable", () => {
    expect(clampFrameTime(4, Number.NaN)).toBe(0);
    expect(clampFrameTime(4, 0)).toBe(0);
  });

  it("collapses to zero when the time is not a number", () => {
    expect(clampFrameTime(Number.NaN, 10)).toBe(0);
  });

  it("clamps below zero", () => {
    expect(clampFrameTime(-3, 10)).toBe(0);
  });

  it("stops short of the duration so the seek still lands on a frame", () => {
    expect(clampFrameTime(99, 10)).toBe(10 - END_EPSILON);
  });

  it("passes an in-range time through", () => {
    expect(clampFrameTime(4.25, 10)).toBe(4.25);
  });
});

describe("stepFrameTime", () => {
  it("advances by one frame", () => {
    expect(stepFrameTime(1, 1, 10)).toBeCloseTo(1 + FRAME_STEP_SECONDS, 6);
  });

  it("retreats by one frame", () => {
    expect(stepFrameTime(1, -1, 10)).toBeCloseTo(1 - FRAME_STEP_SECONDS, 6);
  });

  it("never steps onto the duration itself", () => {
    expect(stepFrameTime(10, 1, 10)).toBe(10 - END_EPSILON);
  });

  it("never steps below zero", () => {
    expect(stepFrameTime(0, -1, 10)).toBe(0);
  });
});

describe("snapFrameTime", () => {
  it("rounds onto a step boundary", () => {
    expect(snapFrameTime(0.05)).toBeCloseTo(2 * FRAME_STEP_SECONDS, 6);
  });

  it("falls back to zero for a time the browser has not resolved", () => {
    expect(snapFrameTime(Number.NaN)).toBe(0);
  });
});

describe("formatFrameTime", () => {
  it("formats a sub-minute time", () => {
    expect(formatFrameTime(3.4166)).toBe("0:03.417");
  });

  it("formats zero", () => {
    expect(formatFrameTime(0)).toBe("0:00.000");
  });

  it("formats minutes without an hour field", () => {
    expect(formatFrameTime(65)).toBe("1:05.000");
  });

  it("adds the hour field past an hour", () => {
    expect(formatFrameTime(3725.5)).toBe("1:02:05.500");
  });

  it("falls back for a time the browser has not resolved", () => {
    expect(formatFrameTime(Number.NaN)).toBe("0:00.000");
    expect(formatFrameTime(Number.POSITIVE_INFINITY)).toBe("0:00.000");
    expect(formatFrameTime(-1)).toBe("0:00.000");
  });
});

describe("frameSaveOutcome", () => {
  it("reports a written frame", () => {
    const outcome = frameSaveOutcome(
      { copied: ["clip.jpg"], skipped: [], rejected: [] },
      "clip.jpg",
    );

    expect(outcome).toEqual({ variant: "success", message: "Saved frame as clip.jpg." });
  });

  it("still reads as success when the response also reports a skip", () => {
    const outcome = frameSaveOutcome(
      { copied: ["clip.jpg"], skipped: ["clip.jpg"], rejected: [] },
      "clip.jpg",
    );

    expect(outcome.variant).toBe("success");
  });

  it("reports a rejected file", () => {
    const outcome = frameSaveOutcome(
      { copied: [], skipped: [], rejected: ["clip.jpg"] },
      "clip.jpg",
    );

    expect(outcome).toEqual({
      variant: "danger",
      message: "Could not save clip.jpg: the server rejected that file.",
    });
  });

  it("warns when the file was skipped", () => {
    const outcome = frameSaveOutcome(
      { copied: [], skipped: ["clip.jpg"], rejected: [] },
      "clip.jpg",
    );

    expect(outcome).toEqual({
      variant: "warning",
      message: "clip.jpg was not saved - the server skipped it.",
    });
  });

  it("reports an empty response as a failure", () => {
    const outcome = frameSaveOutcome({ copied: [], skipped: [], rejected: [] }, "clip.jpg");

    expect(outcome).toEqual({
      variant: "danger",
      message: "Could not save clip.jpg: the server saved nothing.",
    });
  });
});
