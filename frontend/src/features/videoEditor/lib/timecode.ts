/**
 * Typed times for exact entry. A field accepts the timecode it shows (``HH:MM:SS:FF``, or its
 * shorter tails such as ``SS:FF``), a frame count (``36f``), seconds (``1.5s``), or a change of
 * the current value in frames (``+12``, ``-3``). Results land on the project's frame grid.
 */
export function parseTimecode(text: string, frameRate: number, current = 0): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const perSecond = Math.max(1, Math.round(frameRate));
  const relative = /^([+-])\s*(\d+)$/.exec(value);
  if (relative) {
    const frames = Number(relative[2]) * (relative[1] === "-" ? -1 : 1);
    return Math.round(current * frameRate + frames) / frameRate;
  }
  const frames = /^(\d+)\s*f$/.exec(value);
  if (frames) return Number(frames[1]) / frameRate;
  const seconds = /^(\d+(?:\.\d+)?)\s*s$/.exec(value);
  if (seconds) return Math.round(Number(seconds[1]) * frameRate) / frameRate;
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const [frame, ...rest] = parts.map(Number).reverse();
  if (frame >= perSecond) return null;
  const [secs = 0, minutes = 0, hours = 0] = rest;
  if (rest.length > 1 && secs >= 60) return null;
  if (rest.length > 2 && minutes >= 60) return null;
  const whole = hours * 3600 + minutes * 60 + secs;
  return (whole * perSecond + frame) / frameRate;
}
