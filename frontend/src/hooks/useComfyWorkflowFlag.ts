import { useEffect, useState } from "react";
import { fetchComfyWorkflow } from "../api";
import { supportsComfyWorkflow } from "../gallery/comfyWorkflow";
import { deferNonCriticalWork } from "../utils/defer";
import { useStaleRequest } from "./useStaleRequest";

export function useComfyWorkflowFlag(path: string | undefined): boolean {
  const [hasComfyWorkflow, setHasComfyWorkflow] = useState(false);
  const { next, isCurrent } = useStaleRequest();

  useEffect(() => {
    if (!path || !supportsComfyWorkflow(path)) {
      setHasComfyWorkflow(false);
      return;
    }

    const requestId = next();

    return deferNonCriticalWork(() => {
      void fetchComfyWorkflow(path)
        .then((result) => {
          if (!isCurrent(requestId)) return;
          setHasComfyWorkflow(result.has_workflow);
        })
        .catch(() => {
          if (!isCurrent(requestId)) return;
          setHasComfyWorkflow(false);
        });
    });
  }, [isCurrent, next, path]);

  return hasComfyWorkflow;
}
