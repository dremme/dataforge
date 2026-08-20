import { describe, expect, it } from "vitest";
import {
  cardBodyHeight,
  estimateCardHeight,
  estimateNativeAspectRowHeight,
  galleryColumnWidth,
  mediaAspectRatio,
} from "./mediaAspect";

const layout = { minColumnWidth: 280, rowEstimate: 320, captionRowEstimate: 400 };

describe("mediaAspectRatio", () => {
  it("uses the file's pixel size when both sides are present", () => {
    expect(mediaAspectRatio({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9);
  });

  it("falls back to 4:3 when a side is missing", () => {
    expect(mediaAspectRatio({ width: 1920, height: null })).toBeCloseTo(4 / 3);
    expect(mediaAspectRatio({})).toBeCloseTo(4 / 3);
  });
});

describe("galleryColumnWidth", () => {
  it("splits the container into equal columns after gaps", () => {
    expect(galleryColumnWidth(1000, 3, 20)).toBeCloseTo((1000 - 40) / 3);
  });
});

describe("estimateCardHeight", () => {
  it("keeps a 4:3 file at the uniform large-card height", () => {
    expect(cardBodyHeight(false, layout)).toBeCloseTo(110);
    expect(estimateCardHeight({ width: 1600, height: 1200 }, 280, layout)).toBeCloseTo(320);
  });

  it("makes portraits taller and landscapes shorter than 4:3 at the same column width", () => {
    const landscape = estimateCardHeight({ width: 1600, height: 900 }, 280, layout);
    const portrait = estimateCardHeight({ width: 900, height: 1600 }, 280, layout);
    expect(landscape).toBeLessThan(320);
    expect(portrait).toBeGreaterThan(320);
  });
});

describe("estimateNativeAspectRowHeight", () => {
  it("uses the tallest card in the row so left-to-right neighbors stay in one row", () => {
    const landscape = { width: 1600, height: 900, description: null };
    const portrait = { width: 900, height: 1600, description: null };
    expect(estimateNativeAspectRowHeight([landscape, portrait], 280, layout)).toBeCloseTo(
      estimateCardHeight(portrait, 280, layout),
    );
  });
});
