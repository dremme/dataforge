import { createLucideIcon } from "lucide-react";

export const iconAdjustExposure = createLucideIcon("adjust-exposure", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "path",
    {
      d: "M9 8h6m-3-3v6m-3 5h6",
      key: "levels",
    },
  ],
]);

export const iconAdjustBrilliance = createLucideIcon("adjust-brilliance", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "path",
    {
      d: "M12 3a4.5 4.5 0 0 0 0 9 4.5 4.5 0 0 1 0 9",
      key: "tones",
    },
  ],
]);

export const iconAdjustHighlights = createLucideIcon("adjust-highlights", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "path",
    {
      d: "M12 3v18M6 8h6m-7 4h7m-6 4h6",
      key: "light-tones",
    },
  ],
]);

export const iconAdjustShadows = createLucideIcon("adjust-shadows", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "path",
    {
      d: "M12 3v18m0-13h6m-6 4h7m-7 4h6",
      key: "dark-tones",
    },
  ],
]);

export const iconAdjustContrast = createLucideIcon("adjust-contrast", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "path",
    {
      d: "M12 7a5 5 0 0 1 0 10Z",
      key: "contrast",
    },
  ],
]);

export const iconAdjustBrightness = createLucideIcon("adjust-brightness", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 4,
      key: "sun",
    },
  ],
  [
    "path",
    {
      d: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
      key: "rays",
    },
  ],
]);

export const iconAdjustBlackPoint = createLucideIcon("adjust-black-point", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 1,
      key: "black-point",
    },
  ],
]);

export const iconAdjustWhitePoint = createLucideIcon("adjust-white-point", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 4,
      key: "white-point",
    },
  ],
]);

export const iconAdjustSaturation = createLucideIcon("adjust-saturation", [
  [
    "path",
    {
      d: "M12 3c-2 3-7 7.5-7 11a7 7 0 0 0 14 0c0-3.5-5-8-7-11Z",
      key: "drop",
    },
  ],
  [
    "path",
    {
      d: "M8 14a4 4 0 0 0 4 4",
      key: "color",
    },
  ],
]);

export const iconAdjustVibrance = createLucideIcon("adjust-vibrance", [
  [
    "path",
    {
      d: "M13.58 13.79c.27 .68 .42 1.43 .42 2.21c0 1.77-.77 3.37-2 4.46a5.93 5.93 0 0 1-4 1.54c-3.31 0-6-2.69-6-6c0-2.76 1.88-5.1 4.42-5.79",
      key: "lower-left",
    },
  ],
  [
    "path",
    {
      d: "M17.58 10.21c2.54 .69 4.42 3.03 4.42 5.79c0 3.31-2.69 6-6 6a5.93 5.93 0 0 1-4-1.54",
      key: "lower-right",
    },
  ],
  [
    "path",
    {
      d: "M6 8a6 6 0 1 0 12 0 6 6 0 1 0-12 0",
      key: "upper",
    },
  ],
]);

export const iconAdjustWarmth = createLucideIcon("adjust-warmth", [
  [
    "path",
    {
      d: "M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z",
      key: "thermometer",
    },
  ],
  [
    "path",
    {
      d: "M12 10v8",
      key: "temperature",
    },
  ],
]);

export const iconAdjustTint = createLucideIcon("adjust-tint", [
  [
    "path",
    {
      d: "M12 3c-2 3-7 7.5-7 11a7 7 0 0 0 14 0c0-3.5-5-8-7-11Z",
      key: "drop",
    },
  ],
  [
    "path",
    {
      d: "M5 14c2-2 4-2 7 0s5 2 7 0",
      key: "cast",
    },
  ],
]);

export const iconAdjustHue = createLucideIcon("adjust-hue", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 4,
      key: "inner",
    },
  ],
  [
    "path",
    {
      d: "M12 3v5m4 4h5m-12 3-4 3",
      key: "segments",
    },
  ],
]);

export const iconAdjustDefinition = createLucideIcon("adjust-definition", [
  [
    "path",
    {
      d: "m10.3 4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z",
      key: "triangle",
    },
  ],
  [
    "path",
    {
      d: "M12 7v11",
      key: "edge",
    },
  ],
]);

export const iconAdjustNoiseReduction = createLucideIcon("adjust-noise-reduction", [
  [
    "circle",
    {
      cx: 12,
      cy: 12,
      r: 9,
      key: "outline",
    },
  ],
  [
    "path",
    {
      d: "m15 5-9 14",
      key: "boundary",
    },
  ],
  [
    "path",
    {
      d: "M8 8h.01M6 12h.01M11 6h.01M10 11h.01M8 15h.01",
      key: "noise",
    },
  ],
]);

/** An autoencoder's bow tie: pixels squeezed into a small latent, then widened back. */
export const iconVae = createLucideIcon("vae", [
  [
    "path",
    {
      d: "M3 5l7 5v4l-7 5zM21 5l-7 5v4l7 5z",
      key: "bow-tie",
    },
  ],
]);
