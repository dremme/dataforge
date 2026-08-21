/**
 * How far to slide a box horizontally to bring it back inside the viewport,
 * as a signed pixel offset (negative moves it left). Zero when it already fits.
 *
 * The "shift" behaviour Popper/Floating UI provide, for elements anchored to a
 * trigger that may sit near a window edge. It never trades one overflow for the
 * other: a box too wide for the gap travels as far as the opposite edge allows
 * and stops there, rather than sliding off the far side.
 *
 * Pure on purpose — pass `window.innerWidth` in. The `gutter` is per-caller,
 * because how close a bubble may sit to the edge is a visual choice, not a
 * shared constant.
 */
export function horizontalViewportShift(
  rect: { left: number; width: number },
  viewportWidth: number,
  gutter: number,
): number {
  const right = rect.left + rect.width;

  const overflowRight = right - (viewportWidth - gutter);
  if (overflowRight > 0) {
    return -Math.min(overflowRight, Math.max(0, rect.left - gutter));
  }

  const overflowLeft = gutter - rect.left;
  if (overflowLeft > 0) {
    return Math.min(overflowLeft, Math.max(0, viewportWidth - gutter - right));
  }

  return 0;
}
