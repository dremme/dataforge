import { axisViewportShift } from "./viewportShift";

export type AnchoredSide = "top" | "right" | "bottom" | "left";
export type AnchoredAlign = "start" | "center" | "end";

export type AnchoredPlacement = `${AnchoredSide}-${AnchoredAlign}`;

export interface AnchoredRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface AnchoredPositionInput {
  /** The trigger, in viewport coordinates. */
  anchor: AnchoredRect;
  /** Natural size of the floating element, measured with any previous cap removed. */
  floating: { width: number; height: number };
  viewport: { width: number; height: number };
  placement: AnchoredPlacement;
  /** Gap between the anchor and the floating element. */
  offset: number;
  /** Gap kept between the floating element and the window edge. */
  gutter: number;
  flip: boolean;
}

export interface AnchoredPositionResult {
  left: number;
  top: number;
  /** The side actually used, after any flip — drives the arrow and the entry transform. */
  side: AnchoredSide;
  /** Cross-axis correction applied, so an arrow can travel back by the same amount. */
  shift: number;
  /** Set only where the chosen side gives less room than the element wants. */
  maxWidth?: number;
  maxHeight?: number;
}

const OPPOSITE_SIDE: Record<AnchoredSide, AnchoredSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

function isVertical(side: AnchoredSide): boolean {
  return side === "top" || side === "bottom";
}

/** How much space the side leaves between the anchor and the window edge. */
function roomOn(
  side: AnchoredSide,
  anchor: AnchoredRect,
  viewport: { width: number; height: number },
  offset: number,
  gutter: number,
): number {
  switch (side) {
    case "top":
      return anchor.top - offset - gutter;
    case "bottom":
      return viewport.height - (anchor.top + anchor.height + offset) - gutter;
    case "left":
      return anchor.left - offset - gutter;
    case "right":
      return viewport.width - (anchor.left + anchor.width + offset) - gutter;
  }
}

function alignedStart(
  align: AnchoredAlign,
  anchorStart: number,
  anchorLength: number,
  length: number,
): number {
  if (align === "start") return anchorStart;
  if (align === "end") return anchorStart + anchorLength - length;
  return anchorStart + anchorLength / 2 - length / 2;
}

export function computeAnchoredPosition({
  anchor,
  floating,
  viewport,
  placement,
  offset,
  gutter,
  flip,
}: AnchoredPositionInput): AnchoredPositionResult {
  const [preferred, align] = placement.split("-") as [AnchoredSide, AnchoredAlign];

  const room = (side: AnchoredSide) => roomOn(side, anchor, viewport, offset, gutter);
  const mainNatural = (side: AnchoredSide) => (isVertical(side) ? floating.height : floating.width);

  // Flip only to escape a side that cannot hold the element, and only when the
  // other side is genuinely roomier — otherwise a cramped surface would flap.
  const opposite = OPPOSITE_SIDE[preferred];
  const side =
    flip && room(preferred) < mainNatural(preferred) && room(opposite) > room(preferred)
      ? opposite
      : preferred;

  const vertical = isVertical(side);
  const crossNatural = vertical ? floating.width : floating.height;
  const crossViewport = vertical ? viewport.width : viewport.height;

  const mainLength = Math.min(mainNatural(side), Math.max(0, room(side)));
  const crossLength = Math.min(crossNatural, Math.max(0, crossViewport - gutter * 2));

  const crossAnchorStart = vertical ? anchor.left : anchor.top;
  const crossAnchorLength = vertical ? anchor.width : anchor.height;
  const crossStart = alignedStart(align, crossAnchorStart, crossAnchorLength, crossLength);
  const shift = axisViewportShift(
    { start: crossStart, length: crossLength },
    crossViewport,
    gutter,
  );
  const cross = crossStart + shift;

  // A shrunken element on a near side grows away from the anchor, so its own
  // size decides where it starts.
  const main =
    side === "bottom"
      ? anchor.top + anchor.height + offset
      : side === "top"
        ? anchor.top - offset - mainLength
        : side === "right"
          ? anchor.left + anchor.width + offset
          : anchor.left - offset - mainLength;

  const width = vertical ? crossLength : mainLength;
  const height = vertical ? mainLength : crossLength;

  return {
    left: vertical ? cross : main,
    top: vertical ? main : cross,
    side,
    shift,
    // Reported only where it binds: an unconditional cap would override the
    // element's own CSS max-width and let it grow rather than hold it back.
    maxWidth: width < floating.width ? width : undefined,
    maxHeight: height < floating.height ? height : undefined,
  };
}
