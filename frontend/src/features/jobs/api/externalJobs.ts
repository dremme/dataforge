import { requestJson } from "@/shared/api/http";
import type {
  ExternalOstrisJobStopResponse,
  ExternalOstrisJobsResponse,
  OstrisTrainingSamplesResponse,
} from "@/shared/types";

export async function fetchOstrisJobs(signal?: AbortSignal): Promise<ExternalOstrisJobsResponse> {
  return requestJson<ExternalOstrisJobsResponse>("/api/external/ostris/jobs", { signal });
}

export async function fetchOstrisTrainingSamples(
  trainingName: string,
  signal?: AbortSignal,
): Promise<OstrisTrainingSamplesResponse> {
  return requestJson<OstrisTrainingSamplesResponse>(
    `/api/external/ostris/training/${encodeURIComponent(trainingName)}/samples`,
    { signal },
  );
}

export async function stopOstrisJob(jobId: string): Promise<ExternalOstrisJobStopResponse> {
  return requestJson<ExternalOstrisJobStopResponse>(`/api/external/ostris/jobs/${jobId}/stop`, {
    method: "POST",
  });
}
