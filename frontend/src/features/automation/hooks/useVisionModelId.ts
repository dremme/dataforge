import { useQuery } from "@tanstack/react-query";
import { VISION_MODEL_QUERY_KEY, fetchVisionModelId } from "@/features/automation/api/visionLlm";

/** The vision model id for UI badges; saving settings is what changes it. */
export function useVisionModelId(): string {
  const { data } = useQuery({
    queryKey: VISION_MODEL_QUERY_KEY,
    queryFn: fetchVisionModelId,
    staleTime: Infinity,
  });
  return data ?? "";
}
