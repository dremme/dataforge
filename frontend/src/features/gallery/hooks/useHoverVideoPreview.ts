import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

/** Long enough that sweeping the cursor across the grid never starts a download. */
export const HOVER_PREVIEW_DELAY_MS = 400;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function useHoverVideoPreview(enabled: boolean) {
  const [previewing, setPreviewing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPreviewing(false);
  }, []);

  useEffect(() => {
    if (!enabled) cancel();
    return cancel;
  }, [cancel, enabled]);

  // Touch fires pointerenter on a tap, which would fetch a video nobody hovered.
  const onPointerEnter = useCallback(
    (event: PointerEvent) => {
      if (!enabled || event.pointerType === "touch" || prefersReducedMotion()) return;

      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setPreviewing(true);
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [enabled],
  );

  return {
    previewing,
    hoverHandlers: { onPointerEnter, onPointerLeave: cancel },
  };
}
