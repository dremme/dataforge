import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Breathing room between an open menu and the edges of the window. */
export const MENU_VIEWPORT_GUTTER = 16;

/**
 * Measure an open menu against the viewport and keep the result current across
 * resizes, clearing it on close so the next open measures from scratch.
 *
 * A menu hangs off its trigger, so how much room it has depends on where that
 * trigger sits — which is why CSS viewport units cannot express the limit and
 * each menu passes its own `measure`. What is shared is only the scaffolding:
 * measure on open, re-measure on resize, and drop the stale bounds on close.
 *
 * `measure` runs against the live node before paint. It must not read back a
 * value it itself set — that feeds into the next measurement and compounds.
 */
export function useMenuViewportFit<T>(
  menuRef: RefObject<HTMLElement | null>,
  open: boolean,
  measure: (node: HTMLElement) => T,
): T | undefined {
  const [bounds, setBounds] = useState<T>();
  // Read through a ref so an inline `measure` does not resubscribe every render.
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useLayoutEffect(() => {
    if (!open) {
      setBounds(undefined);
      return;
    }

    const fitToViewport = () => {
      const node = menuRef.current;
      if (!node) return;
      setBounds(measureRef.current(node));
    };

    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, [menuRef, open]);

  return bounds;
}
