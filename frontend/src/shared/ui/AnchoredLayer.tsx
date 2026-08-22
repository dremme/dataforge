import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, type AnchoredOptions } from "@/shared/hooks/useAnchoredPosition";
import { classNames } from "@/shared/lib/classNames";

interface AnchoredLayerProps extends AnchoredOptions {
  /** The trigger this surface hangs off. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** Supply one where the caller also needs the node — `usePopupMenu` does, to dismiss. */
  floatingRef?: RefObject<HTMLDivElement | null>;
  /** Keep the surface mounted this long after close, so an exit animation can finish. */
  exitDuration?: number;
  className?: string;
  id?: string;
  role?: string;
  /** Becomes `aria-label`; the panel is out of DOM order, so it names itself. */
  label?: string;
  children: ReactNode;
}

/**
 * The portal and placement plumbing every anchored surface needs — the tooltip
 * and every popup menu.
 *
 * Deliberately owns no chrome, the way `ModalShell` owns none: no background,
 * border, padding or arrow. A menu panel and a tooltip bubble look nothing alike
 * and keeping their looks out is what lets both share this without a mode flag.
 *
 * It portals for the same reason it positions in JS: anchored surfaces sit inside
 * toolbars, drawers and modals that clip and re-stack their descendants, and a
 * surface that hangs off a trigger has to be free of both.
 */
export function AnchoredLayer({
  anchorRef,
  open,
  floatingRef,
  exitDuration = 0,
  className,
  id,
  role,
  label,
  children,
  ...options
}: AnchoredLayerProps) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const resolvedRef = floatingRef ?? fallbackRef;

  // Adjusted during render rather than in an effect: a close that unmounted
  // first and armed the exit afterwards would tear the surface out and put it
  // straight back, and the animation it was waiting for would never run.
  const [wasOpen, setWasOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    setExiting(!open && exitDuration > 0);
  }

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setExiting(false), exitDuration);
    return () => window.clearTimeout(timer);
  }, [exiting, exitDuration]);

  // A surface on its way out still tracks its anchor: the page can scroll
  // underneath it while it fades.
  useAnchoredPosition(anchorRef, resolvedRef, open || exiting, options);

  if (!(open || exiting)) return null;

  return createPortal(
    <div
      ref={resolvedRef}
      id={id}
      className={classNames("anchored", className)}
      role={role}
      aria-label={label}
      data-state={open ? "open" : "closed"}
      // A surface that is only still here to finish its exit is no longer part
      // of the interface, whatever it still looks like.
      aria-hidden={open ? undefined : true}
      tabIndex={-1}
      // Menus scroll inside themselves, and one can be open over a locked page.
      data-scroll-lock-allow
    >
      {children}
    </div>,
    document.body,
  );
}
