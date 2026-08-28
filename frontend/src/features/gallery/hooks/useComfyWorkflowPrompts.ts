import { useEffect, useState } from "react";
import { fetchComfyWorkflowPrompts } from "@/features/gallery/api/captions";
import { formatApiError } from "@/shared/api/http";
import type { ComfyWorkflowPromptsResponse } from "@/shared/types";

export interface ComfyWorkflowPromptsState {
  loading: boolean;
  error: string | null;
  data: ComfyWorkflowPromptsResponse | null;
}

const IDLE: ComfyWorkflowPromptsState = { loading: false, error: null, data: null };

/** Parsing the graph is far heavier than the badge probe, so it waits until the dialog opens. */
export function useComfyWorkflowPrompts(
  path: string | undefined,
  open: boolean,
): ComfyWorkflowPromptsState {
  const [state, setState] = useState<ComfyWorkflowPromptsState>(IDLE);

  useEffect(() => {
    if (!open || !path) {
      setState(IDLE);
      return;
    }

    setState({ loading: true, error: null, data: null });
    const controller = new AbortController();

    void (async () => {
      try {
        const data = await fetchComfyWorkflowPrompts(path, controller.signal);
        if (!controller.signal.aborted) setState({ loading: false, error: null, data });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ loading: false, error: formatApiError(error), data: null });
        }
      }
    })();

    return () => controller.abort();
  }, [open, path]);

  return state;
}
