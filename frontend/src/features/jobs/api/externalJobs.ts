import { requestJson } from "@/shared/api/http";
import type {
  ExternalOstrisJobStopResponse,
  ExternalOstrisJobsResponse,
  OstrisTrainingSamplesResponse,
} from "@/shared/types";

export async function fetchOstrisJobs(): Promise<ExternalOstrisJobsResponse> {
  return requestJson<ExternalOstrisJobsResponse>("/api/external/ostris/jobs");
}

export async function fetchOstrisTrainingSamples(
  trainingName: string,
): Promise<OstrisTrainingSamplesResponse> {
  return requestJson<OstrisTrainingSamplesResponse>(
    `/api/external/ostris/training/${encodeURIComponent(trainingName)}/samples`,
  );
}

export async function stopOstrisJob(jobId: string): Promise<ExternalOstrisJobStopResponse> {
  return requestJson<ExternalOstrisJobStopResponse>(`/api/external/ostris/jobs/${jobId}/stop`, {
    method: "POST",
  });
}
