import { useEffect, useState } from "react";
import { fetchSystemSpecs } from "@/features/automation/api/system";
import type { SystemSpecs } from "@/shared/types";

const REFRESH_INTERVAL_MS = 30_000;

/** Survives AutomationPanel remounts when browsing folders. */
let cachedSpecs: SystemSpecs | null = null;

/** Test helper — clears the module cache. */
export function resetSystemSpecsCacheForTests(): void {
  cachedSpecs = null;
}

export function useSystemSpecs(): SystemSpecs | null {
  const [specs, setSpecs] = useState<SystemSpecs | null>(() => cachedSpecs);

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
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return specs;
}
