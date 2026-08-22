/**
 * How far to slide a box along one axis to bring it back inside the viewport,
 * as a signed pixel offset (negative moves it towards the axis origin). Zero
 * when it already fits.
 *
 * The "shift" behaviour Popper/Floating UI provide, for elements anchored to a
 * trigger that may sit near a window edge. It never trades one overflow for the
 * other: a box too long for the gap travels as far as the opposite edge allows
 * and stops there, rather than sliding off the far side.
 *
 * Axis-agnostic on purpose — `start`/`length` are left/width across, top/height
 * down. Pure too: pass the viewport extent in. The `gutter` is per-caller,
 * because how close a surface may sit to the edge is a visual choice, not a
 * shared constant.
 */
export function axisViewportShift(
  span: { start: number; length: number },
  viewportLength: number,
  gutter: number,
): number {
  const end = span.start + span.length;

  const overflowEnd = end - (viewportLength - gutter);
  if (overflowEnd > 0) {
    return -Math.min(overflowEnd, Math.max(0, span.start - gutter));
  }

  const overflowStart = gutter - span.start;
  if (overflowStart > 0) {
    return Math.min(overflowStart, Math.max(0, viewportLength - gutter - end));
  }

  return 0;
}
