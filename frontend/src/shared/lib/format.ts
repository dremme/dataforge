export function formatMegapixels(width: number, height: number): string {
  const mp = (width * height) / 1_000_000;
  if (mp < 1) return `${mp.toFixed(2)} MP`;
  if (mp < 100) return `${mp.toFixed(1)} MP`;
  return `${Math.round(mp)} MP`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatCount(count: number): string {
  return String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function parseDate(isoDate: string): Date | null {
  const timestamp = Date.parse(isoDate);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function calendarDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function clockTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatModifiedAt(isoDate: string): string | null {
  const date = parseDate(isoDate);
  return date ? `${calendarDate(date)}, ${clockTime(date)}` : null;
}

/** Local time of day, e.g. ``14:05``. */
export function formatClockTime(isoDate: string): string | null {
  const date = parseDate(isoDate);
  return date ? clockTime(date) : null;
}

/** ``Today``, ``Yesterday`` or the local calendar date, e.g. ``Mar 15, 2026``. */
export function formatDayLabel(isoDate: string, nowMs = Date.now()): string | null {
  const date = parseDate(isoDate);
  if (!date) return null;

  const now = new Date(nowMs);
  if (date.toDateString() === now.toDateString()) return "Today";
  now.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Yesterday";
  return calendarDate(date);
}

const RELATIVE_STEPS: ReadonlyArray<[string, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
];

export function formatRelativeTime(isoDate: string, nowMs = Date.now()): string | null {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return null;

  let elapsed = (nowMs - timestamp) / 1000;
  if (elapsed < 45) return "just now";

  for (const [unit, span] of RELATIVE_STEPS) {
    if (Math.abs(elapsed) < span) {
      const count = Math.round(elapsed);
      if (unit === "day" && count === 1) return "yesterday";
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    }
    elapsed /= span;
  }

  return formatModifiedAt(isoDate);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Rough token count for the caption and prompt editors. Deliberately not a real tokenizer.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(countWords(trimmed), Math.ceil(trimmed.length / 4));
}

/** Finite positive seconds, or ``null`` when the listing had no length. */
export function durationSeconds(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

/** Media length: ``5 s`` under a minute, then ``m:ss`` or ``h:mm:ss``. */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  const value = durationSeconds(seconds);
  if (value == null) return "";

  // Rounded first so 59.6 s reads as a minute, never as "60 s".
  const total = Math.round(value);
  if (total < 60) return `${total} s`;

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

/** Length where a small difference is the point, e.g. ``10.4 s``. The list column rounds. */
export function formatDurationPrecise(seconds: number | null | undefined): string {
  const value = durationSeconds(seconds);
  return value == null ? "" : `${value.toFixed(1)} s`;
}

export function formatBytes(bytes: number): string {
  return `${formatBytesValue(bytes)} GB`;
}

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Per-file size; formatBytes is pinned to GB for disk capacity. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Bytes are always whole; anything scaled keeps one decimal until it is large
  // enough that the fraction is noise.
  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${FILE_SIZE_UNITS[unit]}`;
}

/** Unitless counterpart of {@link formatBytes}, for "x / y GB" pairs. */
export function formatBytesValue(bytes: number): string {
  return String(Math.round(bytes / 1024 ** 3));
}
