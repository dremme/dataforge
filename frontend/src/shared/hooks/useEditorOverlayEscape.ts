import { useEffect, useRef, type RefObject } from "react";
import { closeCodeEditorSearchPanel } from "@/shared/lib/codeEditorSearch";

export function useEditorOverlayEscape(
  overlayRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  enabled = true,
  active = true,
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (closeCodeEditorSearchPanel(overlayRef.current)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.defaultPrevented) return;

      event.stopPropagation();
      if (enabled) onEscapeRef.current();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, enabled, overlayRef]);
}
