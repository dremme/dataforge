import { useCallback, useEffect, useRef, useState } from "react";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";

export function useQuickAction() {
  const [open, setOpen] = useState(false);

  // Attach once; re-subscribing on open/close drops a keydown mid-flight in StrictMode.
  const openRef = useRef(open);
  openRef.current = open;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.code !== "Space" && event.key !== " ") return;

      // Close before the lock-depth check; this palette holds a lock of its own.
      if (openRef.current) {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (getScrollLockDepth() > 0) return;

      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { open, close };
}
