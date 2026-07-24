import { useEffect, useState } from "react";
import { fetchSystemSpecs } from "../api/system";
import type { SystemSpecs } from "../types";

const REFRESH_INTERVAL_MS = 30_000;

export function useSystemSpecs(): SystemSpecs | null {
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchSystemSpecs();
        if (!cancelled) {
          setSpecs(data);
        }
      } catch {
        if (!cancelled) {
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
