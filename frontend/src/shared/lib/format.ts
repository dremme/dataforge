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

export function formatModifiedAt(isoDate: string): string | null {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return null;

  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${hours}:${minutes}`;
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

/** Video length for the list's duration column, e.g. ``5 s``. */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  const value = durationSeconds(seconds);
  return value == null ? "" : `${value.toFixed(0)} s`;
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
