/**
 * The crop rectangle's geometry, shared by the video and image editors.
 *
 * Everything here works in fractions of the source frame, never pixels. That is what
 * lets `backend/video_edit.py` write `iw`/`ih` expressions without probing the source,
 * lets `backend/image_edit.py` round to whole pixels on its own terms, and lets one
 * overlay component sit on a `<video>` and an `<img>` alike.
 *
 * Rounding lives in the two feature libs rather than here: video truncates to even
 * numbers because `yuv420p` cannot express an odd dimension, and a still has no chroma
 * plane to keep in step.
 */

/** Small enough to frame tightly, large enough that the rect stays grabbable. */
export const MIN_CROP_FRACTION = 0.05;
export const CROP_NUDGE_FRACTION = 0.01;
export const CROP_NUDGE_MULTIPLIER = 5;

const IDENTITY_EPSILON = 1e-9;

/** How far a rectangle may sit from a listed shape and still count as that shape. */
const ASPECT_TOLERANCE = 0.005;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CropAspect {
  id: string;
  label: string;
  /** Width over height, or null for a rectangle the user shapes freely. */
  ratio: number | null;
}

/** How a crop may be shaped: freely, or locked to one of these, in orientation pairs. */
export const CROP_ASPECTS: readonly CropAspect[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "2:3", label: "2:3", ratio: 2 / 3 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

export const IDENTITY_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const CROP_HANDLES: readonly CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const CORNER_HANDLES = new Set<CropHandle>(["nw", "ne", "se", "sw"]);

export function isCornerHandle(handle: CropHandle): boolean {
  return CORNER_HANDLES.has(handle);
}

/** A quarter-turn count, in clockwise degrees. */
export type RotationDegrees = 0 | 90 | 180 | 270;

/**
 * How the preview is turned relative to the frame the crop is measured in.
 *
 * Only the image editor ever sets this; a video preview is always upright. The overlay
 * reads it to interpret drags, since the rectangle rides inside the same transform the
 * picture does.
 */
export interface Orientation {
  rotate: RotationDegrees;
  mirrorH: boolean;
  mirrorV: boolean;
}

export const UPRIGHT: Orientation = { rotate: 0, mirrorH: false, mirrorV: false };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function isIdentityCrop(crop: CropRect): boolean {
  return (
    Math.abs(crop.x) < IDENTITY_EPSILON &&
    Math.abs(crop.y) < IDENTITY_EPSILON &&
    Math.abs(crop.width - 1) < IDENTITY_EPSILON &&
    Math.abs(crop.height - 1) < IDENTITY_EPSILON
  );
}

export function clampCrop(rect: CropRect): CropRect {
  const width = clamp(rect.width, MIN_CROP_FRACTION, 1);
  const height = clamp(rect.height, MIN_CROP_FRACTION, 1);
  return {
    width,
    height,
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
  };
}

export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

/**
 * Drag one handle by (dx, dy), keeping the opposite edge or corner pinned.
 *
 * Under an aspect lock the height follows the width, which is why edge handles are not
 * offered then: an edge drag has no second axis to derive the other dimension from
 * without guessing which way the rectangle should grow.
 */
export function resizeCrop(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null = null,
): CropRect {
  let { x, y, width, height } = rect;

  if (handle.includes("w")) {
    const shift = clamp(dx, -x, width - MIN_CROP_FRACTION);
    x += shift;
    width -= shift;
  }
  if (handle.includes("e")) {
    width = clamp(width + dx, MIN_CROP_FRACTION, 1 - x);
  }
  if (handle.includes("n")) {
    const shift = clamp(dy, -y, height - MIN_CROP_FRACTION);
    y += shift;
    height -= shift;
  }
  if (handle.includes("s")) {
    height = clamp(height + dy, MIN_CROP_FRACTION, 1 - y);
  }

  if (ratio === null) {
    return clampCrop({ x, y, width, height });
  }

  // Aspect is expressed in the frame's own pixels, and this rectangle is in fractions of
  // it, so the caller passes a ratio already divided by the frame's aspect.
  height = clamp(width / ratio, MIN_CROP_FRACTION, 1);
  width = clamp(height * ratio, MIN_CROP_FRACTION, 1);

  if (handle.includes("n")) {
    y = rect.y + rect.height - height;
  }
  if (handle.includes("w")) {
    x = rect.x + rect.width - width;
  }

  return clampCrop({ x, y, width, height });
}

/**
 * Which of `CROP_ASPECTS` a rectangle already has, or "free" when it has none of them.
 *
 * Seeding the panel from a stored spec has to restore the shape the crop was made with,
 * not just its numbers: the rect would otherwise come back locked to nothing while
 * sitting at a locked shape, and the first handle drag would quietly break the ratio.
 * The tolerance covers the pixel rounding the render applies to the fractions.
 */
export function aspectIdForCrop(crop: CropRect, source: Size): string {
  const width = source.width * crop.width;
  const height = source.height * crop.height;
  if (isIdentityCrop(crop) || !(width > 0) || !(height > 0)) return "free";

  const ratio = width / height;
  const match = CROP_ASPECTS.find(
    (aspect) => aspect.ratio !== null && Math.abs(aspect.ratio - ratio) <= ASPECT_TOLERANCE * ratio,
  );
  return match?.id ?? "free";
}

/** A crop of ``ratio`` centred in the frame, as large as it will go. */
export function cropForAspect(ratio: number): CropRect {
  const width = Math.min(1, ratio);
  const height = Math.min(1, 1 / ratio);
  return clampCrop({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
}

/**
 * The box the frame actually paints inside an `object-fit: contain` element.
 *
 * The crop overlay has to sit on the picture, not on the element: everything outside
 * this box is letterboxing, and a rect positioned against the element would be offset
 * by exactly the bars.
 */
export function containedBox(
  boxWidth: number,
  boxHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (boxWidth <= 0 || boxHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
}

/**
 * A drag measured on screen, expressed in the source frame the crop lives in.
 *
 * The image preview carries `rotate(R) scaleX(mx) scaleY(my)` and the overlay rides
 * inside it, so the browser maps a source vector `v` onto the screen as `Rot(R)·Flip·v`.
 * This is the inverse, `Flip·Rot(-R)·s` - the flips are their own inverse, so only the
 * rotation changes direction. Screen y points down, which is why a clockwise quarter
 * turn reads as `(x, y) -> (-y, x)` rather than the other sign.
 *
 * Applied in pixels, before the delta is divided by the painted box: the box is the
 * untransformed layout box, so its width already corresponds to the source's width.
 */
export function screenDeltaToSource(
  dx: number,
  dy: number,
  orientation: Orientation,
): { dx: number; dy: number } {
  let x = dx;
  let y = dy;

  if (orientation.rotate === 90) {
    [x, y] = [y, -x];
  } else if (orientation.rotate === 180) {
    [x, y] = [-x, -y];
  } else if (orientation.rotate === 270) {
    [x, y] = [-y, x];
  }

  if (orientation.mirrorH) x = -x;
  if (orientation.mirrorV) y = -y;

  return { dx: x, dy: y };
}
