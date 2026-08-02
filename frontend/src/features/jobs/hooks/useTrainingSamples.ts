import { useEffect, useMemo, useState } from "react";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { isActiveExternalJobStatus } from "@/features/jobs/lib/externalJobs";
import { isActiveJobStatus } from "@/features/jobs/lib/jobs";
import type { ExternalOstrisJob, Job, OstrisTrainingSample } from "@/shared/types";

/** Samples only appear every 200 steps, so a slow poll is plenty. */
const POLL_MS = 10000;

/** Samples for one AI-Toolkit run. A null name disables the fetch; `poll` only repeats it. */
export function useOstrisTrainingSamples(
  trainingName: string | null,
  options: { poll: boolean },
): OstrisTrainingSample[] {
  const [samples, setSamples] = useState<OstrisTrainingSample[]>([]);
  const { poll } = options;

  useEffect(() => {
    setSamples([]);
  }, [trainingName]);

  useEffect(() => {
    if (!trainingName) return;

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

    if (!poll) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(load, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [poll, trainingName]);

  return samples;
}

/** The sample images from a training job's most recent step. */
export function useTrainingSamples(job: Job | null): OstrisTrainingSample[] {
  const trainingName = job?.job_type === "train_lora" ? (job.external_ref ?? null) : null;
  const active = job ? isActiveJobStatus(job.status) : false;

  const polled = useOstrisTrainingSamples(active ? trainingName : null, { poll: true });

  // A finished run carries its final samples in the job itself; nothing to poll.
  const finalSamples = useMemo(
    () =>
      (job?.results ?? [])
        .filter((result) => result.status === "sample")
        .map((result) => ({
          path: result.path,
          name: result.name,
          step: job?.processed ?? 0,
          prompt: result.description ?? "",
        })),
    [job?.processed, job?.results],
  );

  if (!trainingName) return [];
  return active ? polled : finalSamples;
}

/** The same samples for an AI-Toolkit run DataForge only watches from the outside. */
export function useExternalTrainingSamples(job: ExternalOstrisJob | null): OstrisTrainingSample[] {
  return useOstrisTrainingSamples(job?.name ?? null, {
    poll: job ? isActiveExternalJobStatus(job.status) : false,
  });
}
