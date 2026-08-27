import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";

export interface PopupMenuTriggerProps {
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
}

export interface PopupMenu {
  open: boolean;
  close: () => void;
  menuId: string;
  rootRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  triggerProps: PopupMenuTriggerProps;
}

function useOutsidePointerDown(
  refs: RefObject<HTMLElement | null>[],
  onOutside: () => void,
  enabled: boolean,
): void {
  // A fresh array literal each render must not resubscribe.
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

function usePanelFocus(
  rootRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return;

    const root = rootRef.current;
    panelRef.current?.focus();

    return () => {
      // The removed panel drops focus to body; anything else is a user choice, not ours.
      if (document.activeElement !== document.body) return;
      root?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
    };
  }, [open, panelRef, rootRef]);
}

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
