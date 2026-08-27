import { useEffect, useState } from "react";
import { fetchComfyPresets } from "@/features/automation/api/jobs";

export function useComfyPresetsAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetchComfyPresets(controller.signal);
        if (!controller.signal.aborted) setAvailable(response.presets.length > 0);
      } catch {
        if (!controller.signal.aborted) setAvailable(false);
      }
    })();

    return () => controller.abort();
  }, []);

  return available;
}
