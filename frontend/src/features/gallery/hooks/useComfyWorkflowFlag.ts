import { useQuery } from "@tanstack/react-query";
import { fetchComfyWorkflow } from "@/features/gallery/api/captions";
import { supportsComfyWorkflow } from "@/features/gallery/lib/comfyWorkflow";
import { deferNonCriticalWork } from "@/shared/lib/defer";

export function useComfyWorkflowFlag(path: string | undefined): boolean {
  const supported = Boolean(path) && supportsComfyWorkflow(path!);

  const { data } = useQuery({
    queryKey: ["comfy-workflow-flag", path],
    queryFn: async () => {
      // The badge can wait; the image the modal opened for cannot.
      await new Promise<void>((resolve) => deferNonCriticalWork(resolve));
      return (await fetchComfyWorkflow(path!)).has_workflow;
    },
    enabled: supported,
    retry: false,
  });

  return supported && data === true;
}
