import { useEffect, useRef } from "react";

/**
 * Run `onEscape` when Escape is pressed anywhere in the window.
 * Overlays use this instead of their own listener so the handler identity does
 * not need to be stable — only `enabled` re-subscribes.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onEscapeRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
