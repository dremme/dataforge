import { requestJson } from "@/shared/api/http";
import type { VisionLlmInfoResponse } from "@/shared/types";

let cachedModel: string | null = null;
let inflight: Promise<string> | null = null;

/** Fetch the backend vision model id once; subsequent calls reuse the cache. */
export async function loadVisionModelId(): Promise<string> {
  if (cachedModel !== null) return cachedModel;
  if (inflight) return inflight;

  inflight = requestJson<VisionLlmInfoResponse>("/api/system/vision-llm")
    .then((data) => {
      cachedModel = typeof data.model === "string" ? data.model : "";
      return cachedModel;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Cached model id, or null until the first successful load. */
export function getCachedVisionModelId(): string | null {
  return cachedModel;
}

/** @internal */
export function resetVisionModelIdCacheForTests(): void {
  cachedModel = null;
  inflight = null;
}
