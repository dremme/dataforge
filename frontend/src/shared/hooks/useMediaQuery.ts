import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        const media = window.matchMedia?.(query);
        if (!media) return () => {};
        media.addEventListener("change", onChange);
        return () => media.removeEventListener("change", onChange);
      },
      [query],
    ),
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
