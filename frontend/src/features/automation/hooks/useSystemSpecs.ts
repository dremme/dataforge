import { useEffect, useState } from "react";
import { fetchSystemSpecs } from "@/features/automation/api/system";
import type { SystemSpecs } from "@/shared/types";

const IDLE_REFRESH_INTERVAL_MS = 30_000;
/** Fast enough to watch a job load the machine; each poll also shells out to nvidia-smi. */
export const ACTIVE_REFRESH_INTERVAL_MS = 2_000;

/** Survives AutomationPanel remounts when browsing folders. */
let cachedSpecs: SystemSpecs | null = null;

/** Test helper — clears the module cache. */
export function resetSystemSpecsCacheForTests(): void {
  cachedSpecs = null;
}

/** `live` polls at the fast cadence, e.g. while a job is running. */
export function useSystemSpecs(live = false): SystemSpecs | null {
  const [specs, setSpecs] = useState<SystemSpecs | null>(() => cachedSpecs);

  const intervalMs = live ? ACTIVE_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS;

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchSystemSpecs();
        cachedSpecs = data;
        if (!cancelled) {
          setSpecs(data);
        }
      } catch {
        // Keep last known specs so folder navigations do not blank the panel.
        if (!cancelled && cachedSpecs === null) {
          setSpecs(null);
        }
      }
    };

    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [intervalMs]);

  return specs;
}
