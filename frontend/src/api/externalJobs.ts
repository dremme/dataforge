import { requestJson } from "./http";
import type { ExternalOstrisJobStopResponse, ExternalOstrisJobsResponse } from "../types";

export async function fetchOstrisJobs(): Promise<ExternalOstrisJobsResponse> {
  return requestJson<ExternalOstrisJobsResponse>("/api/external/ostris/jobs");
}

export async function stopOstrisJob(jobId: string): Promise<ExternalOstrisJobStopResponse> {
  return requestJson<ExternalOstrisJobStopResponse>(`/api/external/ostris/jobs/${jobId}/stop`, {
    method: "POST",
  });
}
