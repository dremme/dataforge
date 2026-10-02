import { useQuery } from "@tanstack/react-query";
import { fetchOstrisTrainingSamples } from "@/features/jobs/api/externalJobs";
import { fetchJobResults } from "@/features/jobs/api/jobs";
import { isActiveExternalJobStatus } from "@/features/jobs/lib/externalJobs";
import { jobKeys } from "@/features/jobs/lib/jobQueries";
import { isActiveJobStatus } from "@/features/jobs/lib/jobs";
import type { ExternalOstrisJob, Job, OstrisTrainingSample } from "@/shared/types";

/** Samples only appear every 200 steps, so a slow poll is plenty. */
const POLL_MS = 10000;

const NO_SAMPLES: OstrisTrainingSample[] = [];

/** Samples for one AI-Toolkit run. A null name disables the fetch; `poll` only repeats it. */
export function useOstrisTrainingSamples(
  trainingName: string | null,
  options: { poll: boolean },
): OstrisTrainingSample[] {
  const { data } = useQuery({
    queryKey: jobKeys.samples(trainingName ?? ""),
    queryFn: async ({ signal }) =>
      (await fetchOstrisTrainingSamples(trainingName!, signal)).samples,
    enabled: Boolean(trainingName),
    refetchInterval: options.poll ? POLL_MS : false,
    refetchIntervalInBackground: true,
    // A missing AI-Toolkit just means no samples to show yet.
    retry: false,
  });

  return (trainingName && data) || NO_SAMPLES;
}

function useFinishedRunSamples(job: Job | null, enabled: boolean): OstrisTrainingSample[] {
  const jobId = job?.id ?? "";
  const step = job?.processed ?? 0;

  const { data } = useQuery({
    queryKey: jobKeys.finishedSamples(jobId, step),
    queryFn: async ({ signal }) =>
      (await fetchJobResults(jobId, signal))
        .filter((result) => result.status === "sample")
        .map((result) => ({
          path: result.path,
          name: result.name,
          step,
          prompt: result.description ?? "",
        })),
    enabled: enabled && Boolean(jobId),
    // A job whose history has been pruned simply has no samples left to show.
    retry: false,
  });

  return (enabled && data) || NO_SAMPLES;
}

/** The sample images from a training job's most recent step. */
export function useTrainingSamples(job: Job | null): OstrisTrainingSample[] {
  const trainingName = job?.job_type === "train_lora" ? (job.external_ref ?? null) : null;
  const active = job ? isActiveJobStatus(job.status) : false;

  const polled = useOstrisTrainingSamples(active ? trainingName : null, { poll: true });
  const finished = useFinishedRunSamples(job, Boolean(trainingName) && !active);

  if (!trainingName) return NO_SAMPLES;
  return active ? polled : finished;
}

/** The same samples for an AI-Toolkit run DataForge only watches from the outside. */
export function useExternalTrainingSamples(job: ExternalOstrisJob | null): OstrisTrainingSample[] {
  return useOstrisTrainingSamples(job?.name ?? null, {
    poll: job ? isActiveExternalJobStatus(job.status) : false,
  });
}
