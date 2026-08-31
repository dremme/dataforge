import { describe, expect, it } from "vitest";
import { IDENTITY_CROP, type CropRect, type RotationDegrees } from "./crop";
import {
  draftFromSpec,
  emptyDraft,
  formatRotation,
  formatScale,
  isIdentityEdit,
  orientationOf,
  outputDimensions,
  rotateBy,
  scaleForTargetHeight,
  scaleForTargetWidth,
  specsEqual,
  swapsAxes,
  toImageEditSpec,
  type ImageEditDraft,
} from "./imageEdit";
import { newMaskDraft } from "./mask";
import type { ImageEditSpec, MaskRegion } from "@/shared/types";

const HD = { width: 1920, height: 1080 };

function draft(overrides: Partial<ImageEditDraft> = {}): ImageEditDraft {
  return { ...emptyDraft(), ...overrides };
}

function spec(overrides: Partial<ImageEditSpec> = {}): ImageEditSpec {
  return {
    masks: [],
    crop: null,
    mirror_h: false,
    mirror_v: false,
    rotate: 0,
    scale: 1,
    ...overrides,
  };
}

const REGION: MaskRegion = {
  x: 0.1,
  y: 0.1,
  width: 0.3,
  height: 0.3,
  mode: "blur",
  strength: 0.12,
};

describe("rotateBy", () => {
  it.each([
    [0, 1, 90],
    [90, 1, 180],
    [180, 1, 270],
    [270, 1, 0],
  ] as const)("turns %s right to %s", (from, turns, expected) => {
    expect(rotateBy(from, turns)).toBe(expected);
  });

  it("wraps the other way too, so a left turn from upright lands on 270", () => {
    expect(rotateBy(0, -1)).toBe(270);
    expect(rotateBy(90, -1)).toBe(0);
  });

  it("wraps however many turns it is given at once", () => {
    expect(rotateBy(90, 2)).toBe(270);
    expect(rotateBy(270, 2)).toBe(90);
  });

  it("comes back to where it started after four quarter turns", () => {
    let angle: RotationDegrees = 0;
    for (let i = 0; i < 4; i += 1) angle = rotateBy(angle, 1);

    expect(angle).toBe(0);
  });
});

describe("swapsAxes", () => {
  it.each([
    [0, false],
    [90, true],
    [180, false],
    [270, true],
  ] as const)("says %s", (rotate, expected) => {
    expect(swapsAxes(rotate)).toBe(expected);
  });
});

describe("outputDimensions", () => {
  it("reports the source untouched when nothing is set", () => {
    expect(outputDimensions(HD, IDENTITY_CROP, 0, 1)).toEqual({ width: 1920, height: 1080 });
  });

  it("rounds rather than truncating to an even number", () => {
    // The video editor truncates for `yuv420p`; Pillow is asked for exactly this.
    expect(outputDimensions({ width: 99, height: 99 }, IDENTITY_CROP, 0, 1)).toEqual({
      width: 99,
      height: 99,
    });
  });

  it("applies the crop in the source's own axes", () => {
    const crop: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

    expect(outputDimensions(HD, crop, 0, 1)).toEqual({ width: 960, height: 540 });
  });

  it.each([
    [0, { width: 1920, height: 1080 }],
    [90, { width: 1080, height: 1920 }],
    [180, { width: 1920, height: 1080 }],
    [270, { width: 1080, height: 1920 }],
  ] as const)("swaps the axes for a %s degree turn", (rotate, expected) => {
    expect(outputDimensions(HD, IDENTITY_CROP, rotate, 1)).toEqual(expected);
  });

  it("scales after the turn, exactly as the render resizes last", () => {
    expect(outputDimensions(HD, IDENTITY_CROP, 90, 0.5)).toEqual({ width: 540, height: 960 });
  });

  it("crops, then turns, then scales", () => {
    const crop: CropRect = { x: 0, y: 0, width: 0.5, height: 1 };

    // 960x1080 cropped, 1080x960 turned, 540x480 scaled.
    expect(outputDimensions(HD, crop, 90, 0.5)).toEqual({ width: 540, height: 480 });
  });

  it("never rounds an axis away entirely", () => {
    expect(outputDimensions({ width: 8, height: 4 }, IDENTITY_CROP, 0, 0.05)).toEqual({
      width: 1,
      height: 1,
    });
  });
});

describe("scaleForTarget", () => {
  it("lands the width on the number that was typed", () => {
    const scale = scaleForTargetWidth(HD, IDENTITY_CROP, 0, 960);

    expect(scale).toBeCloseTo(0.5);
    expect(outputDimensions(HD, IDENTITY_CROP, 0, scale).width).toBe(960);
  });

  it("measures against the turned frame, which is what the field is labelled with", () => {
    // Sideways, 1080 across is the whole width; the unrotated 1920 would halve it.
    const scale = scaleForTargetWidth(HD, IDENTITY_CROP, 90, 540);

    expect(scale).toBeCloseTo(0.5);
    expect(outputDimensions(HD, IDENTITY_CROP, 90, scale).width).toBe(540);
  });

  it("moves the other axis with it, so the aspect never drifts", () => {
    const scale = scaleForTargetHeight(HD, IDENTITY_CROP, 0, 540);

    expect(outputDimensions(HD, IDENTITY_CROP, 0, scale)).toEqual({ width: 960, height: 540 });
  });

  it("refuses to upscale, whatever is typed", () => {
    expect(scaleForTargetWidth(HD, IDENTITY_CROP, 0, 4000)).toBe(1);
  });

  it("stops at the lower bound the schema enforces", () => {
    expect(scaleForTargetWidth(HD, IDENTITY_CROP, 0, 1)).toBeCloseTo(0.05);
  });

  it("says 1 rather than dividing by a frame that has no size yet", () => {
    expect(scaleForTargetWidth({ width: 0, height: 0 }, IDENTITY_CROP, 0, 800)).toBe(1);
    expect(scaleForTargetHeight({ width: 0, height: 0 }, IDENTITY_CROP, 0, 800)).toBe(1);
  });
});

describe("edit identity", () => {
  it("an untouched draft would change nothing", () => {
    expect(isIdentityEdit(emptyDraft())).toBe(true);
  });

  it.each([
    ["a crop", draft({ crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } })],
    ["a horizontal mirror", draft({ mirrorH: true })],
    ["a vertical mirror", draft({ mirrorV: true })],
    ["a quarter turn", draft({ rotate: 90 })],
    ["a half turn", draft({ rotate: 180 })],
    ["a scale", draft({ scale: 0.5 })],
    ["a blur region", draft({ masks: [newMaskDraft("blur", 0.12, 0)] })],
  ])("%s is a real edit on its own", (_label, value) => {
    expect(isIdentityEdit(value)).toBe(false);
  });
});

describe("wire conversion", () => {
  it("sends a full-frame crop as no crop at all", () => {
    // The server normalizes the same way, or the two disagree on whether an edit changed it.
    expect(toImageEditSpec(emptyDraft()).crop).toBeNull();
  });

  it("sends every region across with its style and strength", () => {
    const masks = [newMaskDraft("pixelate", 0.22, 0), newMaskDraft("blur", 0.06, 1)];

    const sent = toImageEditSpec(draft({ masks })).masks;

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ mode: "pixelate", strength: 0.22, ...masks[0].rect });
    expect(sent[1]).toMatchObject({ mode: "blur", strength: 0.06 });
  });

  it("brings the regions back out of a stored spec", () => {
    const seeded = draftFromSpec(spec({ masks: [REGION] }));

    expect(seeded.masks).toHaveLength(1);
    expect(seeded.masks[0].rect).toMatchObject({ x: 0.1, y: 0.1, width: 0.3, height: 0.3 });
  });

  it("sends a real crop as its own rectangle", () => {
    const crop: CropRect = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };

    expect(toImageEditSpec(draft({ crop })).crop).toEqual(crop);
  });

  it("carries the mirrors and the angle across", () => {
    expect(toImageEditSpec(draft({ mirrorH: true, mirrorV: true, rotate: 270 }))).toMatchObject({
      mirror_h: true,
      mirror_v: true,
      rotate: 270,
    });
  });

  it("round-trips a spec back into the draft that would produce it", () => {
    const original = spec({
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      mirror_h: true,
      rotate: 180,
      scale: 0.75,
    });

    expect(toImageEditSpec(draftFromSpec(original))).toEqual(original);
  });

  it("opens on an empty draft when there is no stored spec", () => {
    expect(draftFromSpec(null)).toEqual(emptyDraft());
  });

  it("pulls a stored crop back inside the frame", () => {
    const seeded = draftFromSpec(spec({ crop: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } }));

    expect(seeded.crop.x + seeded.crop.width).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("specsEqual", () => {
  it("reads the same regions in the same order as the same file", () => {
    expect(specsEqual(spec({ masks: [REGION] }), spec({ masks: [REGION] }))).toBe(true);
  });

  it("reads two identical specs as the same file", () => {
    expect(specsEqual(spec({ rotate: 90 }), spec({ rotate: 90 }))).toBe(true);
  });

  it.each([
    ["the angle", spec({ rotate: 90 }), spec({ rotate: 180 })],
    ["a mirror", spec({ mirror_h: true }), spec({ mirror_h: false })],
    ["the other mirror", spec({ mirror_v: true }), spec({ mirror_v: false })],
    ["the scale", spec({ scale: 0.5 }), spec({ scale: 0.75 })],
    [
      "the crop",
      spec({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }),
      spec({ crop: { x: 0, y: 0, width: 0.6, height: 0.5 } }),
    ],
    ["a crop against none", spec({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }), spec()],
    ["a blur region against none", spec({ masks: [REGION] }), spec()],
    [
      "the style of a region",
      spec({ masks: [REGION] }),
      spec({ masks: [{ ...REGION, mode: "pixelate" }] }),
    ],
  ])("reports a difference in %s", (_label, a, b) => {
    expect(specsEqual(a, b)).toBe(false);
  });

  it("ignores float noise a normalized drag leaves behind", () => {
    expect(specsEqual(spec({ scale: 0.5 }), spec({ scale: 0.5 + 1e-12 }))).toBe(true);
  });
});

describe("orientationOf", () => {
  it("hands the stage and the overlay the same three values", () => {
    expect(orientationOf(draft({ rotate: 270, mirrorH: true }))).toEqual({
      rotate: 270,
      mirrorH: true,
      mirrorV: false,
    });
  });
});

describe("readouts", () => {
  it("shows a scale as a whole percentage", () => {
    expect(formatScale(0.5)).toBe("50%");
    expect(formatScale(1)).toBe("100%");
  });

  it("shows an angle with its degree sign", () => {
    expect(formatRotation(0)).toBe("0°");
    expect(formatRotation(270)).toBe("270°");
  });
});
