import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function useDialogFocus(
  panelRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const triggerRef = useRef<Element | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const active = document.activeElement;

    // Capture here: a passive effect would already see the panel. StrictMode re-runs
    // after a simulated unmount with focus already on the panel — that must not be the opener.
    if (!panel || !(active instanceof HTMLElement) || !panel.contains(active)) {
      triggerRef.current = active;
    }

    (initialFocusRef?.current ?? panel)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per overlay
  }, []);

  // Passive, not layout: layout cleanup still sees the overlay and would misfire the hand-off.
  useEffect(() => {
    return () => {
      const trigger = triggerRef.current;
      if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return;

      if (document.activeElement !== document.body) return;

      trigger.focus({ preventScroll: true });
    };
  }, []);
}
