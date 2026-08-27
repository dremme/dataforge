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
