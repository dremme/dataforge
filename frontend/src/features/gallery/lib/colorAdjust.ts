import { ADJUST_MAX_HUE, COLOR_ADJUST } from "@/shared/constants";
import type { ColorAdjust } from "@/shared/types";

/** Mirrors backend/color_adjust.py; the generated parity cases hold the two together. */

export type AdjustTool = keyof ColorAdjust;
export type Rgb = [number, number, number];

const IDENTITY_EPSILON = 1e-9;
const DARK_LUMINANCE = 1e-6;
const LUMA: Readonly<Rgb> = [0.2126, 0.7152, 0.0722];

export const RESTING_ADJUST: Readonly<ColorAdjust> = {
  exposure: 0,
  brilliance: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  brightness: 0,
  black_point: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  hue: 0,
  definition: 0,
  noise_reduction: 0,
};

export const ADJUST_TOOL_IDS = Object.keys(RESTING_ADJUST) as AdjustTool[];

/** The tools a LUT carries; definition and noise reduction look at neighbouring pixels. */
export const GLOBAL_TOOLS: readonly AdjustTool[] = ADJUST_TOOL_IDS.filter(
  (tool) => tool !== "definition" && tool !== "noise_reduction",
);

export interface AdjustRange {
  min: number;
  max: number;
  /** One dial unit; tones read as -100..100, hue in degrees. */
  step: number;
}

export function adjustRange(tool: AdjustTool): AdjustRange {
  if (tool === "hue") return { min: -ADJUST_MAX_HUE, max: ADJUST_MAX_HUE, step: 1 };
  if (tool === "definition" || tool === "noise_reduction") return { min: 0, max: 1, step: 0.01 };
  return { min: -1, max: 1, step: 0.01 };
}

export function clampAdjust(adjust: ColorAdjust): ColorAdjust {
  const clamped = { ...adjust };
  for (const tool of ADJUST_TOOL_IDS) {
    const { min, max } = adjustRange(tool);
    clamped[tool] = Math.min(max, Math.max(min, adjust[tool]));
  }
  return clamped;
}

export function isAdjustIdentity(adjust: ColorAdjust): boolean {
  return ADJUST_TOOL_IDS.every((tool) => Math.abs(adjust[tool]) < IDENTITY_EPSILON);
}

export function isGlobalIdentity(adjust: ColorAdjust): boolean {
  return GLOBAL_TOOLS.every((tool) => Math.abs(adjust[tool]) < IDENTITY_EPSILON);
}

export function adjustEqual(a: ColorAdjust, b: ColorAdjust): boolean {
  return ADJUST_TOOL_IDS.every((tool) => Math.abs(a[tool] - b[tool]) < IDENTITY_EPSILON);
}

export function srgbToLinear(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(linear: number): number {
  const clipped = Math.min(1, Math.max(0, linear));
  return clipped <= 0.0031308 ? clipped * 12.92 : 1.055 * clipped ** (1 / 2.4) - 0.055;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function exposed(luminance: number, exposure: number): number {
  const gain = 2 ** (COLOR_ADJUST.exposure_stops * exposure);
  return gain >= 1 ? (gain * luminance) / (1 + (gain - 1) * luminance) : gain * luminance;
}

function shadows(p: number, amount: number): number {
  const k = amount > 0 ? COLOR_ADJUST.shadow_lift : COLOR_ADJUST.shadow_crush;
  return p * (1 + amount * k * (1 - p) ** 3);
}

function highlights(p: number, amount: number): number {
  const k = amount < 0 ? COLOR_ADJUST.highlight_recover : COLOR_ADJUST.highlight_lift;
  return 1 - (1 - p) * (1 - amount * k * p ** 3);
}

function contrast(p: number, amount: number): number {
  return p + amount * (p * p * (3 - 2 * p) - p);
}

function brightness(p: number, amount: number): number {
  return p + COLOR_ADJUST.brightness_gain * amount * p * (1 - p);
}

function blackPoint(p: number, amount: number): number {
  if (amount > 0) {
    const level = COLOR_ADJUST.black_point_level * amount;
    return Math.max(0, (p - level) / (1 - level));
  }
  const lift = -COLOR_ADJUST.black_point_lift * amount;
  return lift + (1 - lift) * p;
}

/** Linear luminance in and out; every stage is monotonic and exactly identity at 0. */
export function toneCurve(luminance: number, adjust: ColorAdjust): number {
  let p = linearToSrgb(exposed(luminance, adjust.exposure));

  const b = adjust.brilliance;
  p = shadows(p, clampUnit(COLOR_ADJUST.brilliance_shadows * b));
  p = highlights(p, clampUnit(-COLOR_ADJUST.brilliance_highlights * b));
  p = contrast(p, clampUnit(COLOR_ADJUST.brilliance_contrast * b));

  p = highlights(p, adjust.highlights);
  p = shadows(p, adjust.shadows);
  p = contrast(p, adjust.contrast);
  p = brightness(p, adjust.brightness);
  p = blackPoint(p, adjust.black_point);
  return srgbToLinear(Math.min(1, Math.max(0, p)));
}

export function whiteBalanceGains(warmth: number, tint: number): Rgb {
  const gains: Rgb = [
    Math.exp(COLOR_ADJUST.warmth_gain * warmth + COLOR_ADJUST.tint_gain * tint),
    Math.exp(-COLOR_ADJUST.tint_gain * tint),
    Math.exp(-COLOR_ADJUST.warmth_gain * warmth + COLOR_ADJUST.tint_gain * tint),
  ];
  const grey = gains[0] * LUMA[0] + gains[1] * LUMA[1] + gains[2] * LUMA[2];
  return [gains[0] / grey, gains[1] / grey, gains[2] / grey];
}

/** The CSS hue-rotate() matrix, row-major: turns chroma and keeps its luma. */
export function hueMatrix(degrees: number): number[] {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const [lr, lg, lb] = [0.213, 0.715, 0.072];
  return [
    lr + c * (1 - lr) - s * lr,
    lg - c * lg - s * lg,
    lb - c * lb + s * (1 - lb),
    lr - c * lr + s * 0.143,
    lg + c * (1 - lg) + s * 0.14,
    lb - c * lb - s * 0.283,
    lr - c * lr - s * (1 - lr),
    lg - c * lg + s * lg,
    lb + c * (1 - lb) + s * lb,
  ];
}

/** In place: out-of-range colors move toward their own grey, keeping luminance and hue. */
function fitGamut(linear: Rgb): void {
  const luminance = linear[0] * LUMA[0] + linear[1] * LUMA[1] + linear[2] * LUMA[2];
  const grey = Math.min(1, Math.max(0, luminance));
  let scale = Infinity;
  for (let channel = 0; channel < 3; channel += 1) {
    const value = linear[channel];
    if (value > 1) scale = Math.min(scale, (1 - grey) / (value - grey));
    if (value < 0) scale = Math.min(scale, grey / (grey - value));
  }
  const t = Math.min(1, Math.max(0, scale));
  for (let channel = 0; channel < 3; channel += 1) {
    linear[channel] = grey + (linear[channel] - grey) * t;
  }
}

type LinearPixel = (
  r: number,
  g: number,
  b: number,
  out: Float32Array | number[],
  at: number,
) => void;

/** Everything that depends on the settings alone, worked out once per LUT rather than per pixel. */
function compile(adjust: ColorAdjust): LinearPixel {
  const gains = whiteBalanceGains(adjust.warmth, adjust.tint);
  const hue = Math.abs(adjust.hue) > IDENTITY_EPSILON ? hueMatrix(adjust.hue) : null;
  const cap = COLOR_ADJUST.tone_chroma_cap;
  const linear: Rgb = [0, 0, 0];

  return (inR, inG, inB, out, at) => {
    let r = inR * gains[0];
    let g = inG * gains[1];
    let b = inB * gains[2];

    const luminance = r * LUMA[0] + g * LUMA[1] + b * LUMA[2];
    const toned = toneCurve(luminance, adjust);
    const ratio = luminance <= DARK_LUMINANCE ? 0 : toned / luminance;
    const chromaGain = Math.min(ratio, cap);
    r = toned + (r - luminance) * chromaGain;
    g = toned + (g - luminance) * chromaGain;
    b = toned + (b - luminance) * chromaGain;

    const high = Math.max(r, g, b);
    const saturation = high > 0 ? (high - Math.min(r, g, b)) / Math.max(high, 1e-12) : 0;
    const chroma = (1 + adjust.saturation) * (1 + adjust.vibrance * (1 - saturation));
    r = toned + (r - toned) * chroma;
    g = toned + (g - toned) * chroma;
    b = toned + (b - toned) * chroma;

    if (hue) {
      linear[0] = hue[0] * r + hue[1] * g + hue[2] * b;
      linear[1] = hue[3] * r + hue[4] * g + hue[5] * b;
      linear[2] = hue[6] * r + hue[7] * g + hue[8] * b;
    } else {
      linear[0] = r;
      linear[1] = g;
      linear[2] = b;
    }

    fitGamut(linear);
    out[at] = linearToSrgb(linear[0]);
    out[at + 1] = linearToSrgb(linear[1]);
    out[at + 2] = linearToSrgb(linear[2]);
  };
}

/** sRGB-encoded in 0..1 to the same, through every global tool. */
export function adjustPixel(rgb: Readonly<Rgb>, adjust: ColorAdjust): Rgb {
  const out: Rgb = [0, 0, 0];
  compile(adjust)(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]), out, 0);
  return out;
}

/** RGBA floats, red varying fastest, then green, then blue: a WebGL 3D texture's layout. */
export function buildAdjustLut(adjust: ColorAdjust, size: number): Float32Array {
  const pixel = compile(adjust);
  const levels = Array.from({ length: size }, (_, index) => srgbToLinear(index / (size - 1)));
  const lut = new Float32Array(size * size * size * 4);
  let index = 0;
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        pixel(levels[red], levels[green], levels[blue], lut, index);
        lut[index + 3] = 1;
        index += 4;
      }
    }
  }
  return lut;
}

/** Signed and a fixed width, so the readout does not jiggle the row under a drag. */
export function formatAdjustValue(tool: AdjustTool, value: number): string {
  if (tool === "hue") {
    const degrees = Math.round(value);
    return `${degrees > 0 ? "+" : ""}${degrees}°`;
  }
  const units = Math.round(value * 100);
  return `${units > 0 ? "+" : ""}${units}`;
}
