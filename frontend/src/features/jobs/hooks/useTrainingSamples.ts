import { useEffect, useState } from "react";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { fetchJobResults } from "@/features/jobs/api/jobs";
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

/**
 * The samples a finished run recorded in its job results.
 *
 * Results are not part of the job itself — they would dominate the job list, which is
 * polled while work runs — so they are fetched here, once, when a run has stopped.
 */
function useFinishedRunSamples(job: Job | null, enabled: boolean): OstrisTrainingSample[] {
  const [samples, setSamples] = useState<OstrisTrainingSample[]>([]);
  const jobId = job?.id ?? null;
  const step = job?.processed ?? 0;

  useEffect(() => {
    if (!enabled || !jobId) {
      setSamples([]);
      return;
    }

    let cancelled = false;

    fetchJobResults(jobId)
      .then((results) => {
        if (cancelled) return;
        setSamples(
          results
            .filter((result) => result.status === "sample")
            .map((result) => ({
              path: result.path,
              name: result.name,
              step,
              prompt: result.description ?? "",
            })),
        );
      })
      .catch(() => {
        // A job whose history has been pruned simply has no samples left to show.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, jobId, step]);

  return samples;
}

/** The sample images from a training job's most recent step. */
export function useTrainingSamples(job: Job | null): OstrisTrainingSample[] {
  const trainingName = job?.job_type === "train_lora" ? (job.external_ref ?? null) : null;
  const active = job ? isActiveJobStatus(job.status) : false;

  const polled = useOstrisTrainingSamples(active ? trainingName : null, { poll: true });
  const finished = useFinishedRunSamples(job, Boolean(trainingName) && !active);

  if (!trainingName) return [];
  return active ? polled : finished;
}

/** The same samples for an AI-Toolkit run DataForge only watches from the outside. */
export function useExternalTrainingSamples(job: ExternalOstrisJob | null): OstrisTrainingSample[] {
  return useOstrisTrainingSamples(job?.name ?? null, {
    poll: job ? isActiveExternalJobStatus(job.status) : false,
  });
}
