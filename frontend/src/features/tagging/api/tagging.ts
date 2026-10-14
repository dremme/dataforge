import { queryOptions } from "@tanstack/react-query";
import { requestJson } from "@/shared/api/http";
import type { TaggingStatusResponse } from "@/shared/types";

export const TAGGING_STATUS_QUERY_KEY = ["tagging-status"] as const;

export function fetchTaggingStatus(signal?: AbortSignal): Promise<TaggingStatusResponse> {
  return requestJson<TaggingStatusResponse>("/api/system/tagging", { signal });
}

/** Kept current by `tagging` events; a reader that needs the per-file count polls on its own. */
export function taggingStatusQueryOptions() {
  return queryOptions({
    queryKey: TAGGING_STATUS_QUERY_KEY,
    queryFn: ({ signal }) => fetchTaggingStatus(signal),
    meta: { pushFed: true },
    staleTime: Infinity,
  });
}
