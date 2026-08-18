import { useCallback, useEffect, useRef, useState } from "react";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";

/**
 * Ctrl/Cmd+Space opens the quick action bar, and closes it again.
 *
 * A hand-rolled window listener rather than a registry, matching the app's other
 * global shortcut (`ToolbarSearch`'s Ctrl+K). No `isEditableTarget` guard: the
 * chord inserts nothing, so it stays reachable while a text field has focus.
 */
export function useQuickAction() {
  const [open, setOpen] = useState(false);

  // Read through a ref so the listener is attached exactly once — re-subscribing
  // on every open/close would drop the keydown that is mid-flight in StrictMode.
  const openRef = useRef(open);
  openRef.current = open;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      // `code` identifies the physical key; `key` for space is " ", which some
      // layouts and IMEs rewrite.
      if (event.code !== "Space" && event.key !== " ") return;

      // Toggling closed has to come before the depth check — the palette holds a
      // scroll lock of its own, so that check would otherwise swallow every press
      // once it is open.
      if (openRef.current) {
        event.preventDefault();
        setOpen(false);
        return;
      }

      // Never over a dialog, modal or drawer. Same gate as Ctrl+K.
      if (getScrollLockDepth() > 0) return;

      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { open, close };
}
