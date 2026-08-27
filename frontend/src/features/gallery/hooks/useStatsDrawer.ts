import { useCallback, useState } from "react";

export function useStatsDrawer() {
  const [statsOpen, setStatsOpen] = useState(false);

  const toggleStats = useCallback(() => setStatsOpen((open) => !open), []);
  const closeStats = useCallback(() => setStatsOpen(false), []);

  return { statsOpen, toggleStats, closeStats };
}
