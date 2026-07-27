import { useEffect, useState } from "react";
import { getCachedVisionModelId, loadVisionModelId } from "@/features/automation/api/visionLlm";

/** Session-cached vision model id for UI badges. */
export function useVisionModelId(): string {
  const [modelId, setModelId] = useState(() => getCachedVisionModelId() ?? "");

  useEffect(() => {
    let cancelled = false;
    loadVisionModelId()
      .then((id) => {
        if (!cancelled) setModelId(id);
      })
      .catch(() => {
        if (!cancelled) setModelId("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return modelId;
}
