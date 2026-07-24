import { useEffect, useState } from "react";
import { fetchComfyWorkflow } from "@/features/gallery/api/captions";
import { supportsComfyWorkflow } from "@/features/gallery/lib/comfyWorkflow";
import { deferNonCriticalWork } from "@/shared/lib/defer";
import { useStaleRequest } from "@/shared/hooks/useStaleRequest";

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
