export function formatMegapixels(width: number, height: number): string {
  const mp = (width * height) / 1_000_000;
  if (mp < 1) return `${mp.toFixed(2)} MP`;
  if (mp < 100) return `${mp.toFixed(1)} MP`;
  return `${Math.round(mp)} MP`;
}

export function formatModifiedAt(isoDate: string): string | null {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return null;

  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function formatBytes(bytes: number): string {
  return `${formatBytesValue(bytes)} GB`;
}

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Scaled file size for a single media file, unlike {@link formatBytes}, which is
 * pinned to GB because it reports disk capacity.
 */
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

export function parseJsonContent(
  content: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value = JSON.parse(content);
    if (typeof value !== "object" || value === null) {
      return { ok: false, error: "Caption JSON must be an object or array." };
    }
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof SyntaxError ? error.message : "Invalid JSON.";
    return { ok: false, error: message };
  }
}
