import { useCallback, useLayoutEffect, type RefObject } from "react";
import { computeAnchoredPosition, type AnchoredPlacement } from "@/shared/lib/anchoredPosition";

export const ANCHORED_GUTTER = 16;
export const ANCHORED_OFFSET = 6;

export interface AnchoredOptions {
  placement?: AnchoredPlacement;
  offset?: number;
  gutter?: number;
  flip?: boolean;
}

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

    // Clear previous placement first; a leftover `left` would shrink a shrink-to-fit box.
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

  useLayoutEffect(() => {
    if (active) reposition();
  });

  useLayoutEffect(() => {
    if (!active) return;

    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, { capture: true, passive: true });

    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, { capture: true });
    };
  }, [active, reposition]);
}
