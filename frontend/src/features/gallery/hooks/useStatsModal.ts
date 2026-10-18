import { useCallback, useState } from "react";

export function useStatsModal() {
  const [statsOpen, setStatsOpen] = useState(false);

  const toggleStats = useCallback(() => setStatsOpen((open) => !open), []);
  const closeStats = useCallback(() => setStatsOpen(false), []);

  return { statsOpen, toggleStats, closeStats };
}
