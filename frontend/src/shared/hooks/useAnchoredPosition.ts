import { useCallback, useLayoutEffect, type RefObject } from "react";
import { computeAnchoredPosition, type AnchoredPlacement } from "@/shared/lib/anchoredPosition";

/** Breathing room between an anchored surface and the edges of the window. */
export const ANCHORED_GUTTER = 16;
/** The gap a dropdown has always left below its trigger. */
export const ANCHORED_OFFSET = 6;

export interface AnchoredOptions {
  placement?: AnchoredPlacement;
  /** Gap between the anchor and the surface. */
  offset?: number;
  /** Gap kept between the surface and the window edge. */
  gutter?: number;
  /** Turn off to keep the surface on its preferred side and let it shrink instead. */
  flip?: boolean;
}

/**
 * Keep a floating element placed against its anchor, and keep it there as the
 * page moves underneath it.
 *
 * The measurement discipline is the whole point: the anchor supplies position,
 * the floating element supplies nothing but its size, and every property this
 * writes is cleared before the next read. Positions are never read back, so an
 * entry animation cannot feed into the next measurement and no correction can
 * compound — the trap each anchored surface used to guard against on its own.
 *
 * Writes land on the node directly rather than through state. Repositioning
 * runs on every scroll frame, and a render per frame is not worth paying.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  active: boolean,
  {
    placement = "bottom-end",
    offset = ANCHORED_OFFSET,
    gutter = ANCHORED_GUTTER,
    flip = true,
  }: AnchoredOptions = {},
): void {
  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;

    // Back to the neutral state this hook owns before measuring. `left` matters
    // as much as the caps: a shrink-to-fit fixed box measures against the room
    // left of the window edge, so a previous nudge would narrow the next read.
    floating.style.left = "";
    floating.style.top = "";
    floating.style.maxWidth = "";
    floating.style.maxHeight = "";

    const anchorRect = anchor.getBoundingClientRect();
    const floatingRect = floating.getBoundingClientRect();

    const { left, top, side, shift, maxWidth, maxHeight } = computeAnchoredPosition({
      anchor: anchorRect,
      floating: { width: floatingRect.width, height: floatingRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement,
      offset,
      gutter,
      flip,
    });

    floating.style.left = `${left}px`;
    floating.style.top = `${top}px`;
    if (maxWidth !== undefined) floating.style.maxWidth = `${maxWidth}px`;
    if (maxHeight !== undefined) floating.style.maxHeight = `${maxHeight}px`;
    floating.dataset.side = side;
    floating.style.setProperty("--anchored-shift", `${shift}px`);
  }, [anchorRef, floatingRef, placement, offset, gutter, flip]);

  // Deliberately every render, not just on mount: a surface whose own content
  // changed while open has to be placed again, and a rect read plus four style
  // writes is cheaper than tracking what might have moved.
  useLayoutEffect(() => {
    if (active) reposition();
  });

  useLayoutEffect(() => {
    if (!active) return;

    window.addEventListener("resize", reposition);
    // Capture, because a scroll inside a modal body or the jobs drawer never
    // reaches the window — and those are exactly where anchored surfaces sit.
    document.addEventListener("scroll", reposition, { capture: true, passive: true });

    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, { capture: true });
    };
  }, [active, reposition]);
}
