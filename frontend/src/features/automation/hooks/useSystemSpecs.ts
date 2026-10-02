import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { systemSpecsQueryOptions } from "@/features/automation/lib/automationQueries";
import type { SystemSpecs } from "@/shared/types";

const IDLE_REFRESH_INTERVAL_MS = 30_000;
/** Fast enough to watch a job load the machine; each poll also shells out to nvidia-smi. */
export const ACTIVE_REFRESH_INTERVAL_MS = 2_000;

/** `live` polls at the fast cadence, e.g. while a job is running. */
export function useSystemSpecs(live = false): SystemSpecs | null {
  // Cached across panel remounts, and a failed poll keeps the last known specs.
  const { data, refetch } = useQuery({
    ...systemSpecsQueryOptions(),
    // The polling cadence owns freshness; remounts and focus need no extra reads.
    staleTime: live ? ACTIVE_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: false,
    refetchInterval: live ? ACTIVE_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });

  // Going live reads at once rather than at the end of an idle interval.
  useEffect(() => {
    if (live) void refetch();
  }, [live, refetch]);

  return data ?? null;
}
