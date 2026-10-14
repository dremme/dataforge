import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalServerEvent } from "@/shared/events/serverEvents";
import type { TaggingStatusResponse } from "@/shared/types";
import { TAGGING_STATUS_QUERY_KEY, taggingStatusQueryOptions } from "../api/tagging";

/** The favorite folder the background tagger is working on right now, or null. */
export function useTaggingFolder(): string | null {
  const queryClient = useQueryClient();
  const { data } = useQuery(taggingStatusQueryOptions());

  useOptionalServerEvent((event) => {
    if (event.type !== "tagging") return;
    queryClient.setQueryData<TaggingStatusResponse>(TAGGING_STATUS_QUERY_KEY, event.status);
  });

  const working = data?.state === "tagging" || data?.state === "loading";
  return working ? (data.folder ?? null) : null;
}
