import { useEffect, useState } from "react";
import { fetchComfyPresets } from "@/features/automation/api/jobs";

/**
 * Whether any ComfyUI workflow preset exists, for the jobs menu to gate on.
 *
 * Fetched once: presets are files a user drops into a folder during setup, not something
 * that changes while the app is open. The dialog fetches the real list every time it
 * opens, so a preset added mid-session is still pickable - it is only this menu entry
 * that waits for a reload, and only in the case where there were none at all before.
 *
 * A failed fetch reports false rather than throwing. The job needs presets to run, so a
 * backend that cannot list them is a backend that cannot start it either.
 */
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
