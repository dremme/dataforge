import { VIDEO_PROJECT_SIZE_PRESET_SHORT_SIDES } from "@/shared/constants";
import type { VideoProjectOrientation } from "@/shared/types";

/**
 * The canvas presets the project settings offer. Aspects are long side over short side, so one
 * preset serves both orientations; its label is flipped for portrait.
 */

export interface AspectPreset {
  value: string;
  ratio: number;
  /** Shown after the ratio, such as the format it is known by. */
  name?: string;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { value: "16:9", ratio: 16 / 9 },
  { value: "4:3", ratio: 4 / 3 },
  { value: "3:2", ratio: 3 / 2 },
  { value: "5:4", ratio: 5 / 4 },
  { value: "1:1", ratio: 1 },
  { value: "1.85:1", ratio: 1.85, name: "Flat" },
  { value: "1.90:1", ratio: 256 / 135, name: "DCI" },
  { value: "2:1", ratio: 2 },
  { value: "2.39:1", ratio: 2.39, name: "Scope" },
];

/** Absorbs rounding both sides to even pixels, yet still parts 1.85 from 1.90. */
const ASPECT_TOLERANCE = 0.01;

export type ResolutionPreset = keyof typeof VIDEO_PROJECT_SIZE_PRESET_SHORT_SIDES;

export const RESOLUTION_NAMES: Record<ResolutionPreset, string> = {
  "480p": "SD",
  "720p": "HD",
  "1080p": "FHD",
  "1440p": "QHD",
  "2160p": "4K",
};

export const RESOLUTION_PRESETS = Object.keys(
  VIDEO_PROJECT_SIZE_PRESET_SHORT_SIDES,
) as ResolutionPreset[];

export interface FrameRatePreset {
  value: string;
  rate: number;
}

/** The NTSC rates are stored exactly, so long timelines do not drift from their sources. */
export const FRAME_RATE_PRESETS: readonly FrameRatePreset[] = [
  { value: "23.976", rate: 24000 / 1001 },
  { value: "24", rate: 24 },
  { value: "25", rate: 25 },
  { value: "29.97", rate: 30000 / 1001 },
  { value: "30", rate: 30 },
  { value: "48", rate: 48 },
  { value: "50", rate: 50 },
  { value: "59.94", rate: 60000 / 1001 },
  { value: "60", rate: 60 },
  { value: "120", rate: 120 },
];

/** Typed rates and probed sources carry three decimals at most, which this still matches. */
const RATE_TOLERANCE = 0.0015;

export function matchAspect(width: number, height: number): AspectPreset | null {
  const ratio = Math.max(width, height) / Math.min(width, height);
  return (
    ASPECT_PRESETS.find((preset) => Math.abs(preset.ratio - ratio) <= ASPECT_TOLERANCE) ?? null
  );
}

export function matchResolution(width: number, height: number): ResolutionPreset | null {
  const short = Math.min(width, height);
  return (
    RESOLUTION_PRESETS.find((key) => VIDEO_PROJECT_SIZE_PRESET_SHORT_SIDES[key] === short) ?? null
  );
}

export function matchFrameRate(rate: number): FrameRatePreset | null {
  return (
    FRAME_RATE_PRESETS.find((preset) => Math.abs(preset.rate - rate) <= RATE_TOLERANCE) ?? null
  );
}

/** `16:9` as written for landscape, `9:16` for portrait. */
export function aspectLabel(value: string, orientation: VideoProjectOrientation): string {
  if (orientation !== "portrait") return value;
  return value.split(":").reverse().join(":");
}

/** A size no preset names, as its ratio to one: `1.78:1`, or `1:1.78` in portrait. */
export function ratioLabel(width: number, height: number): string {
  const ratio = (Math.max(width, height) / Math.min(width, height)).toFixed(2);
  return width < height ? `1:${ratio}` : `${ratio}:1`;
}
