interface ColorDraft {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  hue: number;
}

/** Mirrors backend/image_edit.py: Rec. 601 luma and the warmth channel push. */
const LUMA: readonly [number, number, number] = [0.213, 0.715, 0.072];
const WARMTH_GAIN = 0.2;

const IDENTITY_EPSILON = 1e-9;

export interface ColorRange {
  min: number;
  max: number;
  step: number;
  /** The value that leaves the pixel untouched. */
  identity: number;
}

/** Keyed to the draft fields the sliders drive; mirrors the bounds in backend/schemas.py. */
export const COLOR_RANGES = {
  brightness: { min: 0, max: 2, step: 0.01, identity: 1 },
  contrast: { min: 0, max: 2, step: 0.01, identity: 1 },
  saturation: { min: 0, max: 2, step: 0.01, identity: 1 },
  warmth: { min: -1, max: 1, step: 0.01, identity: 0 },
  hue: { min: 0, max: 359, step: 1, identity: 0 },
} as const satisfies Record<string, ColorRange>;

type Affine = readonly number[];

function multiply(a: Affine, b: Affine): number[] {
  const out: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[row * 4 + k] * b[k * 4 + col];
      out.push(sum);
    }
    let offset = a[row * 4 + 3];
    for (let k = 0; k < 3; k += 1) offset += a[row * 4 + k] * b[k * 4 + 3];
    out.push(offset);
  }
  return out;
}

function saturationAffine(s: number): Affine {
  const [lr, lg, lb] = LUMA;
  return [
    lr + (1 - lr) * s,
    lg - lg * s,
    lb - lb * s,
    0,
    lr - lr * s,
    lg + (1 - lg) * s,
    lb - lb * s,
    0,
    lr - lr * s,
    lg - lg * s,
    lb + (1 - lb) * s,
    0,
  ];
}

function hueAffine(degrees: number): Affine {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const [lr, lg, lb] = LUMA;
  return [
    lr + c * (1 - lr) - s * lr,
    lg - c * lg - s * lg,
    lb - c * lb + s * (1 - lb),
    0,
    lr - c * lr + s * 0.143,
    lg + c * (1 - lg) + s * 0.14,
    lb - c * lb - s * 0.283,
    0,
    lr - c * lr - s * (1 - lr),
    lg - c * lg + s * lg,
    lb + c * (1 - lb) + s * lb,
    0,
  ];
}

/** The five controls composed into one 3x4 matrix, offsets in 0-255 to match Pillow. */
export function colorMatrix(draft: ColorDraft): number[] {
  const offset = (1 - draft.contrast) / 2;
  const b = draft.brightness;

  let matrix: number[] = [b, 0, 0, 0, 0, b, 0, 0, 0, 0, b, 0];
  matrix = multiply(
    [draft.contrast, 0, 0, offset, 0, draft.contrast, 0, offset, 0, 0, draft.contrast, offset],
    matrix,
  );
  matrix = multiply(saturationAffine(draft.saturation), matrix);
  const w = WARMTH_GAIN * draft.warmth;
  matrix = multiply([1 + w, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 - w, 0], matrix);
  matrix = multiply(hueAffine(draft.hue), matrix);

  return matrix.map((value, index) => ((index + 1) % 4 === 0 ? value * 255 : value));
}

/** The 4x5 feColorMatrix form: RGB rows with offsets back in 0-1, then an identity alpha row. */
export function feColorMatrixValues(draft: ColorDraft): string {
  const matrix = colorMatrix(draft);
  const rows: number[][] = [];
  for (let row = 0; row < 3; row += 1) {
    const [m0, m1, m2, off] = matrix.slice(row * 4, row * 4 + 4);
    rows.push([m0, m1, m2, 0, off / 255]);
  }
  rows.push([0, 0, 0, 1, 0]);
  return rows.flat().join(" ");
}

export function isColorIdentity(draft: ColorDraft): boolean {
  return (
    Math.abs(draft.brightness - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.contrast - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.saturation - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.warmth) < IDENTITY_EPSILON &&
    Math.abs(draft.hue) < IDENTITY_EPSILON
  );
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Signed rather than named: a readout that changes width would jiggle the row under a drag. */
export function formatWarmth(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value * 100)}`;
}

export function formatDegrees(value: number): string {
  return `${Math.round(value)}°`;
}
