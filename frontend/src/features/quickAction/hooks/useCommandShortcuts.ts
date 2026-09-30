import { useEffect, useRef } from "react";
import { getScrollLockDepth } from "@/shared/hooks/scrollLockManager";
import { isEditableTarget } from "@/shared/lib/isEditableTarget";
import { matchesShortcut, SHORTCUTS, type ShortcutId } from "@/shared/lib/shortcuts";
import type { QuickActionItem } from "../types";

/** Keys that run their palette row directly; the rest are bound where their feature lives. */
export const PALETTE_BOUND_SHORTCUTS: readonly ShortcutId[] = [
  "openFolder",
  "parentFolder",
  "homeFolder",
  "newFolder",
];

/** Runs a palette row from its key, so the key works exactly when the row is enabled. */
export function useCommandShortcuts(items: readonly QuickActionItem[]): void {
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || getScrollLockDepth() > 0) return;
      // Only a Ctrl/Cmd chord reaches into a field; Alt+letter types dead keys on macOS.
      if (isEditableTarget(event.target) && !(event.ctrlKey || event.metaKey)) return;

      const item = itemsRef.current.find(
        (candidate) =>
          candidate.shortcut !== undefined &&
          PALETTE_BOUND_SHORTCUTS.includes(candidate.shortcut) &&
          matchesShortcut(event, SHORTCUTS[candidate.shortcut]),
      );
      if (!item) return;

      event.preventDefault();
      if (!item.disabled) item.run();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
