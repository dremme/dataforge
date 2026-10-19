import { useQuery } from "@tanstack/react-query";
import { fetchComfyWorkflowPrompts } from "@/features/gallery/api/captions";
import { formatApiError } from "@/shared/api/http";
import type { ComfyWorkflowPromptsResponse } from "@/shared/types";

export interface ComfyWorkflowPromptsState {
  loading: boolean;
  error: string | null;
  data: ComfyWorkflowPromptsResponse | null;
}

/** Parsing the graph is far heavier than the badge probe, so it waits until the dialog opens. */
export function useComfyWorkflowPrompts(
  path: string | undefined,
  open: boolean,
): ComfyWorkflowPromptsState {
  const ready = open && Boolean(path);

  const query = useQuery({
    queryKey: ["comfy-workflow-prompts", path],
    queryFn: ({ signal }) => fetchComfyWorkflowPrompts(path!, signal),
    enabled: ready,
    retry: false,
    // Read the file on each opening; parsing again on focus adds no useful freshness.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  if (!ready) return { loading: false, error: null, data: null };
  return {
    loading: query.isPending,
    error: query.isError ? formatApiError(query.error) : null,
    data: query.data ?? null,
  };
}
