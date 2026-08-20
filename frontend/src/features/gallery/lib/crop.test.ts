import { describe, expect, it } from "vitest";
import {
  IDENTITY_CROP,
  MIN_CROP_FRACTION,
  aspectIdForCrop,
  clampCrop,
  containedBox,
  cropForAspect,
  moveCrop,
  resizeCrop,
  screenDeltaToSource,
  type CropRect,
  type Orientation,
  type RotationDegrees,
} from "./crop";

const HD = { width: 1920, height: 1080 };
const ZERO_SIZE = { width: 0, height: 0 };

function upright(overrides: Partial<Orientation> = {}): Orientation {
  return { rotate: 0, mirrorH: false, mirrorV: false, ...overrides };
}

describe("containedBox", () => {
  it("letterboxes a wide frame in a square box", () => {
    expect(containedBox(400, 400, 1920, 1080)).toEqual({
      left: 0,
      top: 87.5,
      width: 400,
      height: 225,
    });
  });

  it("pillarboxes a tall frame in a wide box", () => {
    expect(containedBox(400, 200, 1080, 1920)).toEqual({
      left: 143.75,
      top: 0,
      width: 112.5,
      height: 200,
    });
  });

  it("fills a box that already matches the frame", () => {
    expect(containedBox(960, 540, 1920, 1080)).toEqual({
      left: 0,
      top: 0,
      width: 960,
      height: 540,
    });
  });

  it("collapses when anything it measures is still zero", () => {
    expect(containedBox(0, 0, 1920, 1080)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
    expect(containedBox(400, 400, 0, 0)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
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

  describe("aspectIdForCrop", () => {
    it.each([
      ["a square", { x: 0.21875, y: 0, width: 0.5625, height: 1 }, "1:1"],
      ["a portrait 9:16", { x: 0.32, y: 0, width: 0.31640625, height: 1 }, "9:16"],
      ["a landscape 4:3", { x: 0.03, y: 0, width: 0.75, height: 1 }, "4:3"],
    ])("names %s by the shape it already has", (_label, crop, expected) => {
      expect(aspectIdForCrop(crop, HD)).toBe(expected);
    });

    it("reads a full frame as free rather than as its own aspect", () => {
      // 1920x1080 is 16:9, and calling that a lock would put the overlay's handles under
      // a constraint the user never asked for.
      expect(aspectIdForCrop(IDENTITY_CROP, HD)).toBe("free");
    });

    it("reads a rectangle matching nothing on the list as free", () => {
      expect(aspectIdForCrop({ x: 0, y: 0, width: 0.9, height: 0.4 }, HD)).toBe("free");
    });

    it("says free rather than dividing by a frame that has no size yet", () => {
      expect(aspectIdForCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, ZERO_SIZE)).toBe("free");
    });
  });
});

describe("screenDeltaToSource", () => {
  it("leaves an upright preview's drags alone", () => {
    expect(screenDeltaToSource(7, -3, upright())).toEqual({ dx: 7, dy: -3 });
  });

  // Screen y points down, so a clockwise quarter turn sends the source's +x to the
  // screen's +y - and the inverse below sends the screen's +y back to the source's +x.
  it.each([
    [0, { dx: 10, dy: 4 }],
    [90, { dx: 4, dy: -10 }],
    [180, { dx: -10, dy: -4 }],
    [270, { dx: -4, dy: 10 }],
  ] as const)("undoes a %s degree turn", (rotate, expected) => {
    expect(screenDeltaToSource(10, 4, upright({ rotate: rotate as RotationDegrees }))).toEqual(
      expected,
    );
  });

  it.each([
    ["neither", { mirrorH: false, mirrorV: false }, { dx: 10, dy: 4 }],
    ["horizontally", { mirrorH: true, mirrorV: false }, { dx: -10, dy: 4 }],
    ["vertically", { mirrorH: false, mirrorV: true }, { dx: 10, dy: -4 }],
    ["both ways", { mirrorH: true, mirrorV: true }, { dx: -10, dy: -4 }],
  ])("undoes a preview mirrored %s", (_label, mirrors, expected) => {
    expect(screenDeltaToSource(10, 4, upright(mirrors))).toEqual(expected);
  });

  it("undoes the rotation before the mirror, the way the transform applies them", () => {
    // `rotate(90deg) scaleX(-1)` maps a source (dx, dy) to (-dy, -dx) on screen; anything
    // that undid the two in the other order would answer (dy, dx) here.
    expect(screenDeltaToSource(-4, -10, upright({ rotate: 90, mirrorH: true }))).toEqual({
      dx: 10,
      dy: 4,
    });
  });

  it("round-trips every orientation back to the drag that produced it", () => {
    // The forward map is what the browser applies: rotate first, then the flips.
    const toScreen = (dx: number, dy: number, o: Orientation) => {
      let x = o.mirrorH ? -dx : dx;
      let y = o.mirrorV ? -dy : dy;
      if (o.rotate === 90) [x, y] = [-y, x];
      else if (o.rotate === 180) [x, y] = [-x, -y];
      else if (o.rotate === 270) [x, y] = [y, -x];
      return { dx: x, dy: y };
    };

    for (const rotate of [0, 90, 180, 270] as const) {
      for (const mirrorH of [false, true]) {
        for (const mirrorV of [false, true]) {
          const orientation: Orientation = { rotate, mirrorH, mirrorV };
          const screen = toScreen(13, -6, orientation);

          expect(screenDeltaToSource(screen.dx, screen.dy, orientation)).toEqual({
            dx: 13,
            dy: -6,
          });
        }
      }
    }
  });
});
