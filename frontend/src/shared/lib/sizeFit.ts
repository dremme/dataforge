import { MEGAPIXEL } from "@/shared/constants";
import type { SizeFit } from "@/shared/types";

// Port of backend/size_fit.py; both sides share one table of cases.

export interface FitSize {
  width: number;
  height: number;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** `even` for video: yuv420p has no odd sizes, so the grid widens to a multiple of 2. */
export function gridMultiple(fit: SizeFit, even = false): number {
  return even ? (fit.multiple * 2) / greatestCommonDivisor(fit.multiple, 2) : fit.multiple;
}

/** The budget at the frame's aspect, each side on the grid and never past the source.
 *  `null` when a side is shorter than one grid cell: reaching it would mean upscaling. */
export function fittedSize(size: FitSize, fit: SizeFit, even = false): FitSize | null {
  const { width, height } = size;
  if (width <= 0 || height <= 0) return null;

  const multiple = gridMultiple(fit, even);
  const largestWidth = Math.floor(width / multiple) * multiple;
  const largestHeight = Math.floor(height / multiple) * multiple;
  if (largestWidth === 0 || largestHeight === 0) return null;

  const scale = Math.min(1, Math.sqrt((fit.megapixels * MEGAPIXEL) / (width * height)));
  return {
    width: Math.max(
      multiple,
      Math.min(Math.round((width * scale) / multiple) * multiple, largestWidth),
    ),
    height: Math.max(
      multiple,
      Math.min(Math.round((height * scale) / multiple) * multiple, largestHeight),
    ),
  };
}

export function formatSizeFit(fit: SizeFit): string {
  return `${fit.megapixels} MP, ${fit.multiple} px grid`;
}
