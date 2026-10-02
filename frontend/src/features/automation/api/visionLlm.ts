import { requestJson } from "@/shared/api/http";
import type { VisionLlmInfoResponse } from "@/shared/types";

export const VISION_MODEL_QUERY_KEY = ["vision-model"] as const;

/** The vision model id the backend is configured with, or "" when it names none. */
export async function fetchVisionModelId(): Promise<string> {
  const data = await requestJson<VisionLlmInfoResponse>("/api/system/vision-llm");
  return typeof data.model === "string" ? data.model : "";
}
