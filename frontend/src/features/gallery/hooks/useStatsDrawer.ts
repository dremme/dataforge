import { useCallback, useState } from "react";

/**
 * Open state for the dataset stats drawer.
 *
 * Deliberately not persisted, where the automation panel's inline toggles are: this
 * is a modal surface with a backdrop and a scroll lock, and restoring it on load
 * would drop the user into the gallery behind an overlay they never opened.
 *
 * Stays open across folder navigation, so the numbers simply follow the new folder.
 */
export function useStatsDrawer() {
  const [statsOpen, setStatsOpen] = useState(false);

  const toggleStats = useCallback(() => setStatsOpen((open) => !open), []);
  const closeStats = useCallback(() => setStatsOpen(false), []);

  return { statsOpen, toggleStats, closeStats };
}
