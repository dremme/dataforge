import { useQuery } from "@tanstack/react-query";
import { fetchComfyLogs } from "@/features/automation/api/jobs";
import { isActiveJobStatus } from "@/features/jobs/lib/jobs";
import type { ComfyLogsResponse, Job } from "@/shared/types";

/**
 * The fastest poll in the app, and deliberately: this is the only sign of life during a render
 * that can run for minutes. The window is a few KB, so the cost is the round trip.
 */
export const COMFY_LOG_POLL_MS = 1000;

/**
 * ComfyUI's console while one of its runs works, or null when there is nothing to show.
 *
 * Keyed by job, so stale output never shows under a fresh run, where it would read as progress.
 */
export function useComfyProcessLogs(job: Job | null): ComfyLogsResponse | null {
  const jobId = job?.id ?? "";
  const enabled = job !== null && job.job_type === "comfy_process" && isActiveJobStatus(job.status);

  // A tick never overlaps a request still out, so a ComfyUI busy sampling is not queued at.
  const { data } = useQuery({
    queryKey: ["comfy-logs", jobId],
    queryFn: ({ signal }) => fetchComfyLogs(signal),
    enabled,
    refetchInterval: COMFY_LOG_POLL_MS,
    refetchIntervalInBackground: true,
    // One dropped poll keeps the last output rather than blanking the log mid-run.
    retry: false,
  });

  return (enabled && data) || null;
}
