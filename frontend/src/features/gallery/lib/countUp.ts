/** How long a tile takes to reach its figure. Short enough to feel like a tick, not a wait. */
export const COUNT_UP_MS = 1000;

/**
 * Integer between ``from`` and ``to`` after ``elapsed`` ms of an ease-out cubic.
 *
 * Easing lands most of the travel early so a large count does not sit on small
 * numbers, then settles rather than slamming into the final digit.
 */
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
