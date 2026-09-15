import { useEffect, useState } from "react";
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
 * Nothing is cached between runs: stale output under a fresh job would read as progress.
 */
export function useComfyProcessLogs(job: Job | null): ComfyLogsResponse | null {
  const [logs, setLogs] = useState<ComfyLogsResponse | null>(null);

  const jobId = job?.id ?? null;
  const enabled = job !== null && job.job_type === "comfy_process" && isActiveJobStatus(job.status);

  useEffect(() => {
    setLogs(null);
  }, [jobId]);

  // Not `job`: every progress frame replaces that object, which would rebuild the timer
  // several times a second.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    // Chained off each settled request rather than an interval: two can never overlap, and a
    // ComfyUI busy sampling backs the poll off by itself instead of queueing requests at it.
    const load = async () => {
      try {
        const response = await fetchComfyLogs(controller.signal);
        if (!cancelled) setLogs(response);
      } catch {
        // Keep the last output: one dropped poll must not blank the log mid-run.
      }
      if (!cancelled) timer = window.setTimeout(load, COMFY_LOG_POLL_MS);
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, jobId]);

  return logs;
}
