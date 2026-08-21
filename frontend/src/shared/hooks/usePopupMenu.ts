import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";

/**
 * The wiring a trigger needs to announce the menu it owns. Spread onto the
 * button so the three ARIA attributes and the toggle stay in one place — they
 * are a set, and a menu that drops one of them is broken only for screen
 * readers, which no visual check would catch.
 */
export interface PopupMenuTriggerProps {
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  /** Only points at the panel while it exists; a dangling id is worse than none. */
  "aria-controls": string | undefined;
  onClick: () => void;
}

export interface PopupMenu {
  open: boolean;
  close: () => void;
  /** Put on the panel, which the trigger's `aria-controls` then references. */
  menuId: string;
  /** Wrap trigger and panel; a press anywhere inside it is not "outside". */
  rootRef: RefObject<HTMLDivElement | null>;
  triggerProps: PopupMenuTriggerProps;
}

/**
 * Dismiss on a pointer press outside `ref`. Listens on mousedown rather than
 * click so the menu closes on press, before whatever sits under the pointer can
 * act on the release. `onOutside` must be stable — the only caller is below.
 */
function useOutsidePointerDown(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onOutside();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [enabled, onOutside, ref]);
}

/**
 * Open/close state for a popup menu: the toggle, the two dismiss gestures
 * (Escape, press outside), and the trigger's ARIA contract.
 *
 * Menus differ entirely in what they list and how they position themselves, so
 * this owns none of that — it exists because the part that is identical in all
 * of them is also the part that is invisible when it goes wrong.
 */
export function usePopupMenu(): PopupMenu {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  useEscapeKey(close, open);
  useOutsidePointerDown(rootRef, close, open);

  return {
    open,
    close,
    menuId,
    rootRef,
    triggerProps: {
      "aria-haspopup": "menu",
      "aria-expanded": open,
      "aria-controls": open ? menuId : undefined,
      onClick: toggle,
    },
  };
}
