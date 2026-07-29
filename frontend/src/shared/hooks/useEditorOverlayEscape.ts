import { useEffect, useRef, type RefObject } from "react";
import { closeCodeEditorSearchPanel } from "@/shared/lib/codeEditorSearch";

/**
 * Escape handling for overlays that host a code editor.
 *
 * Runs in the capture phase for two reasons: the editor's own find panel must
 * get first refusal on Escape, and a parent overlay must not close alongside
 * this one. `enabled` gates only the close — the find panel still closes and
 * propagation still stops while a save is in flight.
 */
export function useEditorOverlayEscape(
  overlayRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  enabled = true,
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
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
  }, [enabled, overlayRef]);
}
