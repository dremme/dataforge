import { describe, expect, it } from "vitest";
import { HISTOGRAM_BINS, measureFrame, WAVEFORM_ROWS } from "./scopes";

/** A ``width × 1`` RGBA strip of the given pixels. */
function strip(pixels: [number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
}

describe("measureFrame", () => {
  it("puts black at the waveform's foot and white at its top, column by column", () => {
    const scopes = measureFrame(
      strip([
        [0, 0, 0],
        [255, 255, 255],
      ]),
      2,
      1,
      2,
    );

    expect(scopes.waveform[(WAVEFORM_ROWS - 1) * 2]).toBe(1);
    expect(scopes.waveform[1]).toBe(1);
    expect(scopes.crushed).toBe(0.5);
    expect(scopes.clipped).toBe(0.5);
  });

  it("counts each channel in its own histogram", () => {
    const scopes = measureFrame(
      strip([
        [255, 0, 0],
        [255, 0, 0],
        [0, 0, 128],
      ]),
      3,
      1,
      3,
    );

    expect(scopes.red[HISTOGRAM_BINS - 1]).toBe(2);
    expect(scopes.green[0]).toBe(3);
    expect(scopes.blue[HISTOGRAM_BINS / 2]).toBe(1);
    expect(scopes.clipped).toBe(0);
  });
});
