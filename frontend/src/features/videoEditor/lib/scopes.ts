/**
 * What the monitor's picture holds, read from its pixels: a luma waveform, an RGB histogram and
 * how much of it is crushed or clipped. They describe the preview as drawn, so a clip drawn from a
 * reduced copy is measured at that size.
 */

/** Rows of the waveform, one per luma level band from black at the bottom to white at the top. */
export const WAVEFORM_ROWS = 64;
export const HISTOGRAM_BINS = 64;
/** Levels at or beyond these count as crushed to black or clipped to white. */
const CRUSHED = 2;
const CLIPPED = 253;

export interface FrameScopes {
  columns: number;
  /** ``columns × WAVEFORM_ROWS`` counts, row-major from the top row down. */
  waveform: Uint32Array;
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  /** Fractions of the pixels whose luma is crushed or clipped. */
  crushed: number;
  clipped: number;
}

/** Rec. 709 weights, as the export's encoder sees an SDR picture. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Reads RGBA ``data`` of a ``width × height`` picture into ``columns`` waveform columns. */
export function measureFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  columns: number,
): FrameScopes {
  const waveform = new Uint32Array(columns * WAVEFORM_ROWS);
  const red = new Uint32Array(HISTOGRAM_BINS);
  const green = new Uint32Array(HISTOGRAM_BINS);
  const blue = new Uint32Array(HISTOGRAM_BINS);
  let crushed = 0;
  let clipped = 0;
  const binOf = (value: number) => Math.min(HISTOGRAM_BINS - 1, (value * HISTOGRAM_BINS) >> 8);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      red[binOf(r)] += 1;
      green[binOf(g)] += 1;
      blue[binOf(b)] += 1;
      const level = luma(r, g, b);
      if (level <= CRUSHED) crushed += 1;
      if (level >= CLIPPED) clipped += 1;
      const row =
        WAVEFORM_ROWS - 1 - Math.min(WAVEFORM_ROWS - 1, Math.floor((level * WAVEFORM_ROWS) / 256));
      const column = Math.min(columns - 1, Math.floor((x * columns) / width));
      waveform[row * columns + column] += 1;
    }
  }
  const total = Math.max(1, width * height);
  return {
    columns,
    waveform,
    red,
    green,
    blue,
    crushed: crushed / total,
    clipped: clipped / total,
  };
}
