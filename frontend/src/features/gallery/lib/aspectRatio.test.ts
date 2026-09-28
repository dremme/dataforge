import { describe, expect, it } from "vitest";
import { aspectRatioLabel, formatAspectRatio } from "./aspectRatio";

describe("aspectRatioLabel", () => {
  it("snaps to the nearest named ratio", () => {
    expect(aspectRatioLabel(1920, 1080)).toBe("16:9");
    expect(aspectRatioLabel(1080, 1440)).toBe("3:4");
  });

  it("snaps ultrawide monitor resolutions to 21:9", () => {
    expect(aspectRatioLabel(2560, 1080)).toBe("21:9");
    expect(aspectRatioLabel(3440, 1440)).toBe("21:9");
  });

  it("falls back to Other outside every named ratio", () => {
    expect(aspectRatioLabel(3000, 1000)).toBe("Other");
  });
});

describe("formatAspectRatio", () => {
  it("shows an exact ratio bare", () => {
    expect(formatAspectRatio(1920, 1080)).toBe("16:9");
    expect(formatAspectRatio(2520, 1080)).toBe("21:9");
  });

  it("treats encoder-padded dimensions as exact", () => {
    expect(formatAspectRatio(1920, 1088)).toBe("16:9");
  });

  it("marks a loosely snapped ratio as approximate", () => {
    expect(formatAspectRatio(2048, 1024)).toBe("~16:9");
    expect(formatAspectRatio(1024, 1000)).toBe("~1:1");
    expect(formatAspectRatio(2560, 1080)).toBe("~21:9");
  });

  it("spells an unnamed landscape ratio as a decimal against one", () => {
    expect(formatAspectRatio(3000, 1000)).toBe("3.00:1");
  });

  it("spells an unnamed portrait ratio as one against a decimal", () => {
    expect(formatAspectRatio(1080, 2560)).toBe("1:2.37");
  });
});
