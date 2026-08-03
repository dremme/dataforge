import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Moves focus into an overlay on open and hands it back to the trigger on close.
 *
 * Both effects run once per overlay session: the focus targets are stable for as
 * long as the overlay is mounted, and re-running would steal focus mid-session.
 */
export function useDialogFocus(
  panelRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const triggerRef = useRef<Element | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const active = document.activeElement;

    // Read here rather than in the effect below: layout effects run first, so a
    // passive effect would already see the panel this one is about to focus.
    //
    // Anything inside the overlay is disqualified. StrictMode re-runs this after
    // a simulated unmount, at which point focus is already on the panel — taking
    // that as the opener would leave a detached node to restore to, and focus
    // would silently stay on <body> at close.
    if (!panel || !(active instanceof HTMLElement) || !panel.contains(active)) {
      triggerRef.current = active;
    }

    // `preventScroll` keeps the container behind the backdrop from jumping to
    // wherever the panel happens to sit.
    (initialFocusRef?.current ?? panel)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per overlay
  }, []);

  // Deliberately a passive effect, not a layout effect: layout cleanups run
  // while the overlay is still in the DOM, so `activeElement` has not yet
  // fallen back to <body> and the hand-off guard below would misfire.
  useEffect(() => {
    return () => {
      const trigger = triggerRef.current;
      if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return;

      // Only reclaim focus that the closing overlay dropped. When one overlay
      // hands off to another in the same commit (gallery item -> issue
      // resolver, or the sysprompt swap), the successor has already taken
      // focus and must keep it.
      if (document.activeElement !== document.body) return;

      trigger.focus({ preventScroll: true });
    };
  }, []);
}
