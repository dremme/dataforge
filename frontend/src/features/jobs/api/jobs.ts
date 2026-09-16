import type { JobsQuery } from "@/features/jobs/lib/jobFilters";
import { requestJson } from "@/shared/api/http";
import type {
  Job,
  JobDeleteResponse,
  JobFileResult,
  JobResultsResponse,
  JobsResponse,
} from "@/shared/types";

export async function fetchLatestFolderJob(folderPath: string): Promise<Job | null> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<Job | null>(`/api/jobs/folder-latest?${params}`);
}

export interface FetchJobsOptions extends JobsQuery {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export async function fetchJobs({
  limit = 100,
  offset = 0,
  jobType,
  status,
  folder,
  signal,
}: FetchJobsOptions = {}): Promise<JobsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset) params.set("offset", String(offset));
  if (jobType) params.set("job_type", jobType);
  if (status) params.set("status", status);
  if (folder) params.set("folder", folder);
  return requestJson<JobsResponse>(`/api/jobs?${params}`, { signal });
}

/** A job's per-file results. Kept off the job list, which is polled while work runs. */
export async function fetchJobResults(jobId: string): Promise<JobFileResult[]> {
  const response = await requestJson<JobResultsResponse>(`/api/jobs/${jobId}/results`);
  return response.results;
}

export async function cancelJob(jobId: string): Promise<Job> {
  return requestJson<Job>(`/api/jobs/${jobId}/cancel`, {
    method: "POST",
  });
}

export async function deleteJob(jobId: string): Promise<JobDeleteResponse> {
  return requestJson<JobDeleteResponse>(`/api/jobs/${jobId}`, {
    method: "DELETE",
  });
}

export async function deleteAllJobs(): Promise<JobDeleteResponse> {
  return requestJson<JobDeleteResponse>("/api/jobs", {
    method: "DELETE",
  });
}
