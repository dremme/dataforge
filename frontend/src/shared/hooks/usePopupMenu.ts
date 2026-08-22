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
  /** Wrap the trigger; a press anywhere inside it is not "outside". */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Hand to `AnchoredLayer`, which portals the panel out of `rootRef`. */
  panelRef: RefObject<HTMLDivElement | null>;
  triggerProps: PopupMenuTriggerProps;
}

/**
 * Dismiss on a pointer press outside every given container. Listens on mousedown
 * rather than click so the menu closes on press, before whatever sits under the
 * pointer can act on the release. `onOutside` must be stable — the only caller
 * is below.
 */
function useOutsidePointerDown(
  refs: RefObject<HTMLElement | null>[],
  onOutside: () => void,
  enabled: boolean,
): void {
  // Read through a ref so a fresh array literal does not resubscribe each render.
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refsRef.current.some((ref) => ref.current?.contains(target))) return;
      onOutside();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [enabled, onOutside]);
}

/**
 * Move focus into the panel while it is open and hand it back afterwards.
 *
 * The panel is portalled to the body, so it no longer follows its trigger in tab
 * order: without this, Tab from an open menu skips straight past it to the next
 * control in the toolbar.
 */
function usePanelFocus(
  rootRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return;

    panelRef.current?.focus();

    return () => {
      // The panel has already been removed by now, and a browser drops focus to
      // the body when the focused element goes with it. Anything else means the
      // user has since chosen where focus should be, and it is not ours to take.
      if (document.activeElement !== document.body) return;
      rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
    };
  }, [open, panelRef, rootRef]);
}

/**
 * Open/close state for a popup menu: the toggle, the two dismiss gestures
 * (Escape, press outside), the trigger's ARIA contract, and the focus handoff
 * its portalled panel needs.
 *
 * Menus differ entirely in what they list, and where they sit is `AnchoredLayer`'s
 * job, so this owns neither — it exists because the part that is identical in all
 * of them is also the part that is invisible when it goes wrong.
 */
export function usePopupMenu(): PopupMenu {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  useEscapeKey(close, open);
  useOutsidePointerDown([rootRef, panelRef], close, open);
  usePanelFocus(rootRef, panelRef, open);

  return {
    open,
    close,
    menuId,
    rootRef,
    panelRef,
    triggerProps: {
      "aria-haspopup": "menu",
      "aria-expanded": open,
      "aria-controls": open ? menuId : undefined,
      onClick: toggle,
    },
  };
}
