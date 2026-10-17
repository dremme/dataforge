import { useEffect } from "react";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const onEscapeRef = useLatestRef(onEscape);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onEscapeRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onEscapeRef]);
}
