import { VIDEO_PROJECT_TRUE_PEAK_CEILING_DB } from "@/shared/constants";

/** The quietest level the bars show; anything below reads as empty. */
const FLOOR_DB = -60;
/** How fast the held peak falls back, in dB per second. */
export const HOLD_FALL_DB_PER_SECOND = 12;

export function toDecibels(peak: number): number {
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** 0 at the floor, 1 at full scale; louder than full scale stays full. */
export function meterFraction(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

export type MeterAlarm = "clip" | "hot" | null;

/** Full scale is where the preview's own output clips; the export limits to the ceiling. */
export function meterAlarm(db: number): MeterAlarm {
  if (db >= 0) return "clip";
  if (db > VIDEO_PROJECT_TRUE_PEAK_CEILING_DB) return "hot";
  return null;
}
