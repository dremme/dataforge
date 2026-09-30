import { useEffect, useRef } from "react";
import { getScrollLockDepth } from "@/shared/hooks/scrollLockManager";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { matchesShortcut, type ShortcutDefinition } from "@/shared/lib/shortcuts";

export interface GlobalShortcutOptions {
  enabled?: boolean;
  /** Also fire while a dialog, modal or drawer holds the scroll lock. */
  whenLocked?: boolean;
  /** Also fire while focus is in a text field or editor. */
  inEditable?: boolean;
}

/** A handler returns `false` to leave the key to the browser. */
export type GlobalShortcutHandler = (event: KeyboardEvent) => void | boolean;

export function useGlobalShortcut(
  shortcut: ShortcutDefinition,
  handler: GlobalShortcutHandler,
  options: GlobalShortcutOptions = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Attach once; re-subscribing on every render drops a keydown mid-flight in StrictMode.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { enabled = true, whenLocked = false, inEditable = false } = optionsRef.current;
      if (!enabled || event.defaultPrevented) return;
      if (!matchesShortcut(event, shortcut)) return;
      if (!whenLocked && getScrollLockDepth() > 0) return;
      if (!inEditable && isEditableTarget(event.target)) return;

      if (handlerRef.current(event) === false) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);
}
