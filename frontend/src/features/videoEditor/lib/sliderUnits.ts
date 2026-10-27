import { AUDIO_HIGH_CUT_MAX_HZ } from "@/shared/constants";
import { formatDecibels, formatHertz, formatHighCut } from "@/shared/lib/audioEffects";
import { formatAdjustValue, type AdjustTool } from "@/features/gallery/lib/colorAdjust";

/** How an inspector slider shows its value, and reads one typed into its field back. */
export interface SliderUnit {
  format: (value: number) => string;
  /** The value typed, in the slider's own scale; null when the text is not a number. */
  parse: (text: string) => number | null;
}

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z%°\s]*)$/i;

/** A number with an optional unit after it: "−3 dB", "50%", "1,5 s" and "1.2k" all read. */
export function parseNumber(text: string): { value: number; suffix: string } | null {
  const match = NUMBER.exec(text.trim().replace(/−/g, "-").replace(",", "."));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, suffix: match[2].trim().toLowerCase() } : null;
}

function scaled(factor: number) {
  return (text: string) => {
    const parsed = parseNumber(text);
    return parsed ? parsed.value / factor : null;
  };
}

/** "Off" or a number of hertz, where a k suffix ("1.2k", "1.2 kHz") means thousands. */
function parseHertz(text: string, off: number): number | null {
  if (text.trim().toLowerCase() === "off") return off;
  const parsed = parseNumber(text);
  if (!parsed) return null;
  return parsed.suffix.startsWith("k") ? parsed.value * 1000 : parsed.value;
}

/** A 0–1 value shown as a whole percentage. */
export const percent: SliderUnit = {
  format: (value) => `${Math.round(value * 100)}%`,
  parse: scaled(100),
};

export const seconds: SliderUnit = {
  format: (value) => `${value.toFixed(2)} s`,
  parse: scaled(1),
};

export const degrees: SliderUnit = {
  format: (value) => `${Math.round(value)}°`,
  parse: scaled(1),
};

/** A 0–1 strength shown as a plain 0–100 number, like the wand's amount. */
export const amount: SliderUnit = {
  format: (value) => String(Math.round(value * 100)),
  parse: scaled(100),
};

export const decibels: SliderUnit = { format: formatDecibels, parse: scaled(1) };

/** The low cut's dial, which is off at its bottom end. */
export const lowCut: SliderUnit = { format: formatHertz, parse: (text) => parseHertz(text, 0) };

/** The high cut's dial, which is off at its top end. */
export const highCut: SliderUnit = {
  format: formatHighCut,
  parse: (text) => parseHertz(text, AUDIO_HIGH_CUT_MAX_HZ),
};

/** A 0–1 strength where nothing reads as "Off". */
export const strength: SliderUnit = {
  format: (value) => (value === 0 ? "Off" : percent.format(value)),
  parse: (text) => (text.trim().toLowerCase() === "off" ? 0 : percent.parse(text)),
};

/** A color tool as the gallery shows it: hue in degrees, the rest as -100 to +100. */
export function adjustUnit(tool: AdjustTool): SliderUnit {
  return {
    format: (value) => formatAdjustValue(tool, value),
    parse: scaled(tool === "hue" ? 1 : 100),
  };
}
