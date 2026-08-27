import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, type AnchoredOptions } from "@/shared/hooks/useAnchoredPosition";
import { classNames } from "@/shared/lib/classNames";

interface AnchoredLayerProps extends AnchoredOptions {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  floatingRef?: RefObject<HTMLDivElement | null>;
  exitDuration?: number;
  className?: string;
  id?: string;
  role?: string;
  label?: string;
  children: ReactNode;
}

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
      aria-hidden={open ? undefined : true}
      tabIndex={-1}
      data-scroll-lock-allow
    >
      {children}
    </div>,
    document.body,
  );
}
