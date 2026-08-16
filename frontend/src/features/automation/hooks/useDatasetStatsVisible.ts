import { useCallback, useState } from "react";
import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";

/**
 * Whether the dataset stats panel is expanded.
 *
 * Session-scoped rather than server-backed like the system specs toggle: this is a
 * per-sitting choice, and keeping it here costs no schema change or round-trip.
 */
const STATS_VISIBLE_KEY = "automation-stats-visible";

function parseStoredVisibility(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function useDatasetStatsVisible() {
  const [showStats, setShowStatsState] = useState(() =>
    readStoredJson(STATS_VISIBLE_KEY, parseStoredVisibility, false, "session"),
  );

  const toggleStats = useCallback(() => {
    setShowStatsState((current) => {
      const next = !current;
      writeStoredJson(STATS_VISIBLE_KEY, next, "session");
      return next;
    });
  }, []);

  return { showStats, toggleStats };
}
