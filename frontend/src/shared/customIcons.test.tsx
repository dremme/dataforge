import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  iconAdjustExposure,
  iconAdjustBrilliance,
  iconAdjustHighlights,
  iconAdjustShadows,
  iconAdjustContrast,
  iconAdjustBrightness,
  iconAdjustBlackPoint,
  iconAdjustWhitePoint,
  iconAdjustSaturation,
  iconAdjustVibrance,
  iconAdjustWarmth,
  iconAdjustTint,
  iconAdjustHue,
  iconAdjustDefinition,
  iconAdjustNoiseReduction,
} from "./icons";
import { Icon } from "./ui/Icon";

describe.each([
  ["Exposure", iconAdjustExposure],
  ["Brilliance", iconAdjustBrilliance],
  ["Highlights", iconAdjustHighlights],
  ["Shadows", iconAdjustShadows],
  ["Contrast", iconAdjustContrast],
  ["Brightness", iconAdjustBrightness],
  ["BlackPoint", iconAdjustBlackPoint],
  ["WhitePoint", iconAdjustWhitePoint],
  ["Saturation", iconAdjustSaturation],
  ["Vibrance", iconAdjustVibrance],
  ["Warmth", iconAdjustWarmth],
  ["Tint", iconAdjustTint],
  ["Hue", iconAdjustHue],
  ["Definition", iconAdjustDefinition],
  ["NoiseReduction", iconAdjustNoiseReduction],
])("%s custom icon", (_name, glyph) => {
  it("uses the shared Lucide outline styling through the icon registry", () => {
    const { container } = render(<Icon icon={glyph} className="adjust-tools__glyph" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("aria-hidden");
    expect(svg).toHaveClass("lucide", "adjust-tools__glyph");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "2");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    const shapes = svg!.querySelectorAll("path, circle, line");
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape).not.toHaveAttribute("transform");
      expect(shape).not.toHaveAttribute("style");
      expect(shape).not.toHaveAttribute("fill");
      expect(shape).not.toHaveAttribute("stroke");
    }
  });
});
