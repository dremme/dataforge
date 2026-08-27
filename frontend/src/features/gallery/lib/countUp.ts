export const COUNT_UP_MS = 2000;

export function easedCount(
  from: number,
  to: number,
  elapsed: number,
  duration = COUNT_UP_MS,
): number {
  if (to === from || elapsed >= duration) return to;
  if (elapsed <= 0) return from;
  const t = Math.min(1, elapsed / duration);
  const eased = 1 - (1 - t) ** 3;
  return Math.round(from + (to - from) * eased);
}
