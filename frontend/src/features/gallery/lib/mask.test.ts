import { describe, expect, it } from "vitest";
import { MIN_MASK_FRACTION } from "./crop";
import {
  DEFAULT_MASK_MODE,
  DEFAULT_MASK_STRENGTH,
  blurRadiusPx,
  MASK_MODES,
  describeMasks,
  maskDraftsFromSpec,
  maskExtent,
  masksEqual,
  modeLabel,
  newMaskDraft,
  pixelBlockPx,
  toMaskRegions,
  type MaskDraft,
} from "./mask";
import type { MaskRegion } from "@/shared/types";

const HD = { width: 1920, height: 1080 };

function mask(overrides: Partial<MaskDraft> = {}): MaskDraft {
  return {
    id: "mask-test",
    rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    mode: DEFAULT_MASK_MODE,
    strength: DEFAULT_MASK_STRENGTH,
    ...overrides,
  };
}

function region(overrides: Partial<MaskRegion> = {}): MaskRegion {
  return {
    x: 0.25,
    y: 0.25,
    width: 0.5,
    height: 0.5,
    mode: "blur",
    strength: DEFAULT_MASK_STRENGTH,
    ...overrides,
  };
}

describe("newMaskDraft", () => {
  it("gives every region an id of its own", () => {
    const first = newMaskDraft("blur", 0.12, 0);
    const second = newMaskDraft("blur", 0.12, 1);

    expect(first.id).not.toEqual(second.id);
  });

  it("steps the next region off the last one so it is not hidden underneath", () => {
    const first = newMaskDraft("blur", 0.12, 0);
    const second = newMaskDraft("blur", 0.12, 1);

    expect(second.rect.x).toBeGreaterThan(first.rect.x);
    expect(second.rect.y).toBeGreaterThan(first.rect.y);
  });

  it("keeps the cascade inside the frame however many are placed", () => {
    for (let placed = 0; placed < 24; placed += 1) {
      const { rect } = newMaskDraft("blur", 0.12, placed);

      expect(rect.x + rect.width).toBeLessThanOrEqual(1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1);
    }
  });

  it("carries the mode and strength it was given", () => {
    const drafted = newMaskDraft("pixelate", 0.22, 0);

    expect(drafted.mode).toBe("pixelate");
    expect(drafted.strength).toBe(0.22);
  });
});

describe("toMaskRegions", () => {
  it("flattens the rectangle and drops the client-side id", () => {
    const [wire] = toMaskRegions([mask({ mode: "pixelate", strength: 0.22 })]);

    expect(wire).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
      mode: "pixelate",
      strength: 0.22,
    });
  });
});

describe("maskDraftsFromSpec", () => {
  it("restores every region with an id to select it by", () => {
    const drafts = maskDraftsFromSpec([region(), region({ x: 0.5, mode: "pixelate" })]);

    expect(drafts).toHaveLength(2);
    expect(drafts[0].id).not.toEqual(drafts[1].id);
    expect(drafts[1].mode).toBe("pixelate");
  });

  it("reads a spec from before regions existed as no regions at all", () => {
    expect(maskDraftsFromSpec(undefined)).toEqual([]);
  });

  it("clamps a stored region to the minimum a region may be, not the crop's", () => {
    const [drafted] = maskDraftsFromSpec([region({ width: 0.02, height: 0.02 })]);

    expect(drafted.rect.width).toBeCloseTo(0.02);
    expect(drafted.rect.width).toBeGreaterThanOrEqual(MIN_MASK_FRACTION);
  });
});

describe("masksEqual", () => {
  it("holds for the same regions in the same order", () => {
    expect(masksEqual([region()], [region()])).toBe(true);
  });

  it("fails on a different count", () => {
    expect(masksEqual([region()], [region(), region()])).toBe(false);
  });

  it("fails on a moved rectangle", () => {
    expect(masksEqual([region()], [region({ x: 0.3 })])).toBe(false);
  });

  it("fails on a different mode or strength", () => {
    expect(masksEqual([region()], [region({ mode: "pixelate" })])).toBe(false);
    expect(masksEqual([region()], [region({ strength: 0.4 })])).toBe(false);
  });

  it("fails when the same regions arrive in another order", () => {
    const first = region({ x: 0.1 });
    const second = region({ x: 0.4 });

    expect(masksEqual([first, second], [second, first])).toBe(false);
  });
});

describe("preview measurements", () => {
  it("measures strength against the region's shorter side in source pixels", () => {
    // Half of a 1920x1080 frame is 960x540, so the height is what a strength is a fraction of.
    expect(maskExtent({ x: 0, y: 0, width: 0.5, height: 0.5 }, HD)).toBeCloseTo(540);
  });

  it("turns a strength into a whole-pixel block size", () => {
    expect(pixelBlockPx(mask({ strength: 0.1 }), HD)).toBe(54);
  });

  it("keeps a blur radius a quarter of that block, so one preset reads alike in both modes", () => {
    expect(blurRadiusPx(mask({ strength: 0.1 }), HD)).toBeCloseTo(13.5);
  });

  it("leaves at least one pixel for a region far too small to divide", () => {
    const tiny = mask({ rect: { x: 0, y: 0, width: 0.001, height: 0.001 }, strength: 0.02 });

    expect(blurRadiusPx(tiny, HD)).toBe(1);
    expect(pixelBlockPx(tiny, HD)).toBe(1);
  });
});

describe("labels", () => {
  it("names each mode", () => {
    expect(modeLabel("blur")).toBe("Blur");
    expect(modeLabel("pixelate")).toBe("Pixelate");
    expect(modeLabel("blackout")).toBe("Blackout");
  });

  it("offers every mode the wire accepts, so a panel cannot omit one", () => {
    expect(MASK_MODES.map((entry) => entry.id)).toEqual(["blur", "pixelate", "blackout"]);
    MASK_MODES.forEach((entry) => expect(entry.label).toBe(modeLabel(entry.id)));
  });

  it("counts regions in a sentence the panel can print", () => {
    expect(describeMasks(1)).toBe("1 masked region");
    expect(describeMasks(3)).toBe("3 masked regions");
  });
});
