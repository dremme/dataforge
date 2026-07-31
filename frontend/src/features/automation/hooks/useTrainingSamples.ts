import { useEffect, useMemo, useState } from "react";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { isActiveJobStatus } from "@/features/jobs/lib/jobs";
import type { Job, OstrisTrainingSample } from "@/shared/types";

/** Samples only appear every 250 steps, so a slow poll is plenty. */
const POLL_MS = 10000;

/** The sample images from a training job's most recent step. */
export function useTrainingSamples(job: Job | null): OstrisTrainingSample[] {
  const [samples, setSamples] = useState<OstrisTrainingSample[]>([]);

  const trainingName = job?.job_type === "train_lora" ? (job.external_ref ?? null) : null;
  const active = job ? isActiveJobStatus(job.status) : false;

  useEffect(() => {
    setSamples([]);
  }, [trainingName]);

  useEffect(() => {
    if (!trainingName || !active) return;

    let cancelled = false;

    const load = () => {
      fetchOstrisTrainingSamples(trainingName)
        .then((response) => {
          if (!cancelled) setSamples(response.samples);
        })
        .catch(() => {
          // A missing AI-Toolkit just means no samples to show yet.
        });
    };

    load();
    const timer = window.setInterval(load, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, trainingName]);

  // A finished run carries its final samples in the job itself; nothing to poll.
  const finalSamples = useMemo(
    () =>
      (job?.results ?? [])
        .filter((result) => result.status === "sample")
        .map((result) => ({
          path: result.path,
          name: result.name,
          step: job?.processed ?? 0,
          prompt: result.description ?? null,
        })),
    [job?.processed, job?.results],
  );

  if (!trainingName) return [];
  return active ? samples : finalSamples;
}
