import { describe, expect, it } from "vitest";
import { IDENTITY_CROP, type CropRect } from "./crop";
import {
  MIN_TRIM_SECONDS,
  clampTrimEnd,
  clampTrimStart,
  cropToPixels,
  draftFromSpec,
  emptyDraft,
  evenTrunc,
  formatScale,
  formatSpeed,
  formatVolume,
  isIdentityEdit,
  outputDimensions,
  outputDuration,
  outputTime,
  scaleForTargetHeight,
  scaleForTargetWidth,
  specsEqual,
  toVideoEditSpec,
  type VideoEditDraft,
} from "./videoEdit";
import { newMaskDraft } from "./mask";
import type { MaskRegion } from "@/shared/types";

const HD = { width: 1920, height: 1080 };

const REGION: MaskRegion = {
  x: 0.1,
  y: 0.1,
  width: 0.3,
  height: 0.3,
  mode: "blur",
  strength: 0.12,
};

function draft(overrides: Partial<VideoEditDraft> = {}): VideoEditDraft {
  return { ...emptyDraft(12), ...overrides };
}

describe("outputDimensions", () => {
  /** Same cases as backend OutputDimensionsTests; both even-truncate so sizes agree. */
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

describe("cropToPixels", () => {
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
    ["a volume change", { volume: 0.5 }],
    ["a mute", { volume: 0 }],
    ["a crop", { crop: { x: 0, y: 0, width: 0.5, height: 1 } }],
    ["a blur region", { masks: [newMaskDraft("blur", 0.12, 0)] }],
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
      volume: 0.5,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    });

    expect(draftFromSpec(toVideoEditSpec(original, 12), 12)).toEqual(original);
  });

  it("sends every region across with its style and strength", () => {
    const masks = [newMaskDraft("pixelate", 0.22, 0)];

    const sent = toVideoEditSpec(draft({ masks }), 12).masks;

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ mode: "pixelate", strength: 0.22, ...masks[0].rect });
  });

  it("brings the regions back out of a stored spec", () => {
    const seeded = draftFromSpec(toVideoEditSpec(draft({ masks: [] }), 12), 12);

    expect(seeded.masks).toEqual([]);
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
  const base = () =>
    toVideoEditSpec(draft({ trimStart: 1, trimEnd: 8, speed: 2, scale: 0.5, volume: 0.5 }), 12);

  it("reports a difference in the regions", () => {
    expect(specsEqual({ ...base(), masks: [REGION] }, base())).toBe(false);
    expect(
      specsEqual(
        { ...base(), masks: [REGION] },
        { ...base(), masks: [{ ...REGION, strength: 0.4 }] },
      ),
    ).toBe(false);
  });

  it("reads the same regions as the same file", () => {
    expect(specsEqual({ ...base(), masks: [REGION] }, { ...base(), masks: [REGION] })).toBe(true);
  });

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
    ["a volume", { volume: 1 }],
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

  it("maps a source moment onto the retimed result", () => {
    expect(outputTime(8, 2)).toBe(4);
    expect(outputTime(8, 0.5)).toBe(16);
    expect(outputTime(8, 1)).toBe(8);
  });

  it("passes the time straight through rather than dividing by a speed it cannot use", () => {
    expect(outputTime(8, 0)).toBe(8);
    expect(outputTime(8, Number.NaN)).toBe(8);
    expect(outputTime(8, -2)).toBe(8);
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

  it("labels the volume, and calls a zero gain a mute", () => {
    expect(formatVolume(1.5)).toBe("150%");
    expect(formatVolume(0.5)).toBe("50%");
    expect(formatVolume(0)).toBe("Mute");
  });
});
