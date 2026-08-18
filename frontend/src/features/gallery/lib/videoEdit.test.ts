import { describe, expect, it } from "vitest";
import {
  IDENTITY_CROP,
  MIN_CROP_FRACTION,
  MIN_TRIM_SECONDS,
  clampCrop,
  clampTrimEnd,
  clampTrimStart,
  containedVideoBox,
  cropForAspect,
  cropToPixels,
  draftFromSpec,
  emptyDraft,
  evenTrunc,
  formatScale,
  formatSpeed,
  isIdentityEdit,
  moveCrop,
  outputDimensions,
  outputDuration,
  resizeCrop,
  scaleForTargetHeight,
  scaleForTargetWidth,
  specsEqual,
  toVideoEditSpec,
  type CropRect,
  type VideoEditDraft,
} from "./videoEdit";

const HD = { width: 1920, height: 1080 };

function draft(overrides: Partial<VideoEditDraft> = {}): VideoEditDraft {
  return { ...emptyDraft(12), ...overrides };
}

describe("outputDimensions", () => {
  /**
   * The same table as `backend/test_video_edit.py::OutputDimensionsTests`. Both sides
   * implement `trunc(x / 2) * 2`, and the panel labels the output from this one, so a
   * drift between them would promise the user a size the render does not produce.
   */
  const cases: Array<[{ width: number; height: number }, number, number, number, number, number]> =
    [
      [{ width: 1920, height: 1080 }, 1, 1, 1, 1920, 1080],
      [{ width: 1920, height: 1080 }, 1, 1, 0.5, 960, 540],
      [{ width: 1920, height: 1080 }, 0.5, 0.5, 1, 960, 540],
      [{ width: 1920, height: 1080 }, 0.5, 0.5, 0.5, 480, 270],
      [{ width: 1920, height: 1080 }, 1, 1, 0.75, 1440, 810],
      [{ width: 1919, height: 1081 }, 1, 1, 1, 1918, 1080],
      [{ width: 1919, height: 1081 }, 0.333, 0.333, 1, 638, 358],
      [{ width: 640, height: 480 }, 1, 1, 0.25, 160, 120],
      [{ width: 641, height: 481 }, 1, 1, 0.25, 160, 120],
    ];

  it.each(cases)(
    "%o cropped to %sx%s at scale %s gives %sx%s",
    (source, cropWidth, cropHeight, scale, width, height) => {
      const crop: CropRect = { x: 0, y: 0, width: cropWidth, height: cropHeight };

      expect(outputDimensions(source, crop, scale)).toEqual({ width, height });
    },
  );

  it("never reports an odd dimension, which yuv420p cannot express", () => {
    for (let width = 100; width < 130; width += 1) {
      const size = outputDimensions({ width, height: width }, IDENTITY_CROP, 0.33);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
    }
  });

  it("truncates rather than rounds, so the output never exceeds the source", () => {
    expect(evenTrunc(1919)).toBe(1918);
    expect(evenTrunc(1921)).toBe(1920);
  });
});

describe("containedVideoBox", () => {
  it("letterboxes a wide frame in a square box", () => {
    expect(containedVideoBox(400, 400, 1920, 1080)).toEqual({
      left: 0,
      top: 87.5,
      width: 400,
      height: 225,
    });
  });

  it("pillarboxes a tall frame in a wide box", () => {
    expect(containedVideoBox(400, 200, 1080, 1920)).toEqual({
      left: 143.75,
      top: 0,
      width: 112.5,
      height: 200,
    });
  });

  it("fills a box that already matches the frame", () => {
    expect(containedVideoBox(960, 540, 1920, 1080)).toEqual({
      left: 0,
      top: 0,
      width: 960,
      height: 540,
    });
  });

  it("collapses when anything it measures is still zero", () => {
    expect(containedVideoBox(0, 0, 1920, 1080)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
    expect(containedVideoBox(400, 400, 0, 0)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});

describe("trim clamping", () => {
  it("keeps the start behind the end by at least the minimum", () => {
    const current = draft({ trimStart: 0, trimEnd: 5 });

    expect(clampTrimStart(9, current, 12)).toBeCloseTo(5 - MIN_TRIM_SECONDS);
  });

  it("keeps the end ahead of the start by at least the minimum", () => {
    const current = draft({ trimStart: 5, trimEnd: 12 });

    expect(clampTrimEnd(1, current, 12)).toBeCloseTo(5 + MIN_TRIM_SECONDS);
  });

  it("clamps to the bounds of the source", () => {
    const current = draft({ trimStart: 0, trimEnd: 12 });

    expect(clampTrimStart(-4, current, 12)).toBe(0);
    expect(clampTrimEnd(99, current, 12)).toBe(12);
  });
});

describe("crop geometry", () => {
  it("keeps a rectangle inside the frame", () => {
    expect(clampCrop({ x: 0.8, y: 0.9, width: 0.5, height: 0.4 })).toEqual({
      x: 0.5,
      y: 0.6,
      width: 0.5,
      height: 0.4,
    });
  });

  it("never lets a rectangle shrink out of reach", () => {
    const tiny = clampCrop({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 });

    expect(tiny.width).toBe(MIN_CROP_FRACTION);
    expect(tiny.height).toBe(MIN_CROP_FRACTION);
  });

  it("moves without resizing, and stops at every edge", () => {
    const rect: CropRect = { x: 0.4, y: 0.4, width: 0.4, height: 0.4 };

    expect(moveCrop(rect, 0.1, 0.1)).toEqual({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 });
    expect(moveCrop(rect, 5, 5)).toEqual({ x: 0.6, y: 0.6, width: 0.4, height: 0.4 });
    expect(moveCrop(rect, -5, -5)).toEqual({ x: 0, y: 0, width: 0.4, height: 0.4 });
  });

  it.each([
    ["e", 0.1, 0, { x: 0.25, y: 0.25, width: 0.6, height: 0.5 }],
    ["w", 0.1, 0, { x: 0.35, y: 0.25, width: 0.4, height: 0.5 }],
    ["s", 0, 0.1, { x: 0.25, y: 0.25, width: 0.5, height: 0.6 }],
    ["n", 0, 0.1, { x: 0.35, y: 0.35, width: 0.5, height: 0.4 }],
  ] as const)("drags the %s handle and pins the opposite edge", (handle, dx, dy, expected) => {
    const rect: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

    const resized = resizeCrop(rect, handle, dx, dy);

    expect(resized.width).toBeCloseTo(expected.width);
    expect(resized.height).toBeCloseTo(expected.height);
    expect(resized.y).toBeCloseTo(expected.y);
  });

  it("drags a corner on both axes at once", () => {
    const rect: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

    const resized = resizeCrop(rect, "se", 0.1, 0.1);

    expect(resized.width).toBeCloseTo(0.6);
    expect(resized.height).toBeCloseTo(0.6);
  });

  it("keeps every handle inside the frame", () => {
    const rect: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const) {
      const resized = resizeCrop(rect, handle, 5, 5);
      expect(resized.x).toBeGreaterThanOrEqual(0);
      expect(resized.y).toBeGreaterThanOrEqual(0);
      expect(resized.x + resized.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(resized.y + resized.height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("derives the height from the width under an aspect lock", () => {
    const rect: CropRect = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

    const resized = resizeCrop(rect, "se", 0.1, 0, 2);

    expect(resized.width / resized.height).toBeCloseTo(2);
  });

  it("centres a locked shape as large as the frame allows", () => {
    const wide = cropForAspect(2);

    expect(wide.width).toBe(1);
    expect(wide.height).toBeCloseTo(0.5);
    expect(wide.y).toBeCloseTo(0.25);
  });

  it("reports the rectangle in source pixels for the overlay readout", () => {
    const crop: CropRect = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };

    expect(cropToPixels(crop, HD)).toEqual({ x: 480, y: 540, width: 960, height: 270 });
  });
});

describe("edit identity", () => {
  it("treats an untouched draft as no edit at all", () => {
    expect(isIdentityEdit(emptyDraft(12), 12)).toBe(true);
  });

  it.each([
    ["a trim in", { trimStart: 1 }],
    ["a trim out", { trimEnd: 8 }],
    ["a speed change", { speed: 2 }],
    ["a rescale", { scale: 0.5 }],
    ["a crop", { crop: { x: 0, y: 0, width: 0.5, height: 1 } }],
  ])("counts %s as an edit", (_label, overrides) => {
    expect(isIdentityEdit(draft(overrides), 12)).toBe(false);
  });
});

describe("wire conversion", () => {
  it("sends no trim end when the draft runs to the end", () => {
    const spec = toVideoEditSpec(draft({ trimStart: 2 }), 12);

    expect(spec.trim_start).toBe(2);
    expect(spec.trim_end).toBeNull();
  });

  it("sends no crop when the rectangle is the whole frame", () => {
    expect(toVideoEditSpec(emptyDraft(12), 12).crop).toBeNull();
  });

  it("round trips a full spec back into a draft", () => {
    const original = draft({
      trimStart: 1,
      trimEnd: 8,
      speed: 2,
      scale: 0.5,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    });

    expect(draftFromSpec(toVideoEditSpec(original, 12), 12)).toEqual(original);
  });

  it("opens on an empty draft when nothing is stored", () => {
    expect(draftFromSpec(null, 12)).toEqual(emptyDraft(12));
  });

  it("never lets a stored trim outrun a shorter source", () => {
    const seeded = draftFromSpec(toVideoEditSpec(draft({ trimEnd: 8 }), 12), 5);

    expect(seeded.trimEnd).toBe(5);
  });
});

describe("specsEqual", () => {
  const base = () => toVideoEditSpec(draft({ trimStart: 1, trimEnd: 8, speed: 2, scale: 0.5 }), 12);

  it("matches a spec against itself", () => {
    expect(specsEqual(base(), base())).toBe(true);
  });

  it("tolerates the float noise a round trip through the wire leaves", () => {
    const drifted = { ...base(), speed: 2 + 1e-12 };

    expect(specsEqual(base(), drifted)).toBe(true);
  });

  it.each([
    ["a trim in", { trim_start: 2 }],
    ["a trim out", { trim_end: 9 }],
    ["a speed", { speed: 4 }],
    ["a scale", { scale: 0.25 }],
  ])("sees a change of %s", (_label, overrides) => {
    expect(specsEqual(base(), { ...base(), ...overrides })).toBe(false);
  });

  it("treats an open-ended trim as different from one that stops", () => {
    expect(specsEqual(base(), { ...base(), trim_end: null })).toBe(false);
    expect(specsEqual({ ...base(), trim_end: null }, { ...base(), trim_end: null })).toBe(true);
  });

  it("compares crops, including one being absent", () => {
    const crop = { x: 0, y: 0, width: 0.5, height: 1 };

    expect(specsEqual({ ...base(), crop }, { ...base(), crop: { ...crop } })).toBe(true);
    expect(specsEqual({ ...base(), crop }, base())).toBe(false);
    expect(specsEqual({ ...base(), crop }, { ...base(), crop: { ...crop, x: 0.1 } })).toBe(false);
  });
});

describe("readouts", () => {
  it("divides the kept span by the speed", () => {
    expect(outputDuration(draft({ trimStart: 2, trimEnd: 10, speed: 2 }))).toBe(4);
  });

  it("finds the scale that lands closest to a target width", () => {
    expect(scaleForTargetWidth(HD, IDENTITY_CROP, 960)).toBeCloseTo(0.5);
    expect(
      outputDimensions(HD, IDENTITY_CROP, scaleForTargetWidth(HD, IDENTITY_CROP, 960)),
    ).toEqual({ width: 960, height: 540 });
  });

  it("finds the scale that lands closest to a target height", () => {
    expect(scaleForTargetHeight(HD, IDENTITY_CROP, 540)).toBeCloseTo(0.5);
  });

  it("keeps the two dimensions on the source aspect, whichever one is set", () => {
    // Both write the one `scale` the spec carries, so they cannot disagree.
    const byWidth = scaleForTargetWidth(HD, IDENTITY_CROP, 960);
    const byHeight = scaleForTargetHeight(HD, IDENTITY_CROP, 540);

    expect(outputDimensions(HD, IDENTITY_CROP, byWidth)).toEqual(
      outputDimensions(HD, IDENTITY_CROP, byHeight),
    );
  });

  it("never asks for an upscale", () => {
    expect(scaleForTargetWidth(HD, IDENTITY_CROP, 4000)).toBe(1);
    expect(scaleForTargetHeight(HD, IDENTITY_CROP, 4000)).toBe(1);
  });

  it("labels speeds and scales the way the buttons read", () => {
    expect(formatSpeed(2)).toBe("2x");
    expect(formatSpeed(0.5)).toBe("0.5x");
    expect(formatScale(0.75)).toBe("75%");
  });
});
